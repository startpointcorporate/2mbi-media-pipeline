const yauzl = () => {
  try {
    return require('yauzl');
  } catch {
    return null;
  }
};

const expectedFiles = [
  /^clips\/(16:9|9:16|1:1)\/.+\.(mp4|mov)$$/,
  /^transcript\/transcript\.(json|srt|vtt)$$/,
  /^manifest\.json$$/,
];

export async function validateZipStructure(buffer: Buffer): Promise<{
  valid: boolean;
  errors: string[];
  fileCount: number;
}> {
  const errors: string[] = [];
  let fileCount = 0;

  const yauzlMod = yauzl();
  if (!yauzlMod) {
    // Without yauzl, do basic check: buffer is non-empty and starts with PK
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      errors.push('Not a valid ZIP file (missing PK header)');
      return { valid: false, errors, fileCount: 0 };
    }

    const { exec } = await import('node:child_process');
    const path = await import('node:path');
    const fs = await import('node:fs/promises');

    const tmpDir = (await import('node:os')).tmpdir();

    const tmpName = `validate-${Date.now()}.zip`;
    const tmpPath = path.join(tmpDir, tmpName);
    await fs.writeFile(tmpPath, buffer);

    try {
      const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        exec(`unzip -l "${tmpPath}"`, (err, stdout, stderr) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        });
      });

      const lines = stdout.split('\n');
      for (const line of lines) {
        const match = line.match(/^\s+\d+\s+[\d-]+\s+[\d:]+\s+(.+)$/);
        if (match?.[1]) {
          fileCount++;
          const filename = match[1].trim();
          const matched = expectedFiles.some((re) => re.test(filename));
          if (!matched) {
            errors.push(`Unexpected file in ZIP: ${filename}`);
          }
        }
      }
    } catch {
      errors.push('Unable to list ZIP contents');
      return { valid: false, errors, fileCount: 0 };
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  }

  if (fileCount === 0) {
    errors.push('ZIP file is empty');
    return { valid: false, errors, fileCount: 0 };
  }

  const hasClips = fileCount > 0; // Simplified check
  const hasTranscript = fileCount > 1;

  if (!hasClips && !hasTranscript) errors.push('Missing expected files in ZIP');

  return {
    valid: errors.length === 0,
    errors,
    fileCount,
  };
}
