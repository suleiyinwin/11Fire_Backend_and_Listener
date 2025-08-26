export const GIB = 1024 ** 3;

// Convert GB (GiB) -> bytes
export function gbToBytes(gbLike) {
  if (gbLike === undefined || gbLike === null || gbLike === '') return null;
  const n = Number(gbLike);
  if (!Number.isFinite(n) || n < 0) return null; 
  return Math.round(n * GIB);
}

// Convert bytes -> GB (GiB)
export function bytesToGb(bytes) {
  if (bytes === undefined || bytes === null) return null;
  return Math.round((bytes / GIB) * 100) / 100;
}
