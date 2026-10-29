function requireInteger(value, name) {
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`);
}

export function buildSamBoxPrompt({ frameIndex, objectId, box, width, height }) {
  requireInteger(frameIndex, "frameIndex");
  requireInteger(objectId, "objectId");
  requireInteger(width, "width");
  requireInteger(height, "height");
  if (frameIndex < 0) throw new Error("frameIndex must be non-negative.");
  if (objectId < 1 || objectId > 16) {
    throw new Error("objectId must be between 1 and 16.");
  }
  if (width < 1 || height < 1) throw new Error("Media dimensions must be positive.");
  for (const coordinate of ["left", "top", "right", "bottom"]) {
    requireInteger(box?.[coordinate], `box.${coordinate}`);
  }
  if (
    box.left < 0 ||
    box.top < 0 ||
    box.right < box.left ||
    box.bottom < box.top ||
    box.right >= width ||
    box.bottom >= height
  ) {
    throw new Error("Box coordinates must be inclusive and inside the media bounds.");
  }
  return `<${frameIndex}f>${objectId}<|box;x1=${box.left};y1=${box.top};x2=${box.right};y2=${box.bottom};w=${width};h=${height}|>`;
}
