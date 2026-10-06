export type RenderBackend =
  | 'auto'
  | 'webgl1'
  | 'webgl2'
  | 'webgpu';

export function isWebGPUSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'gpu' in navigator
  );
}

export function isWebGL2Supported(
  canvas: HTMLCanvasElement,
): boolean {
  try {
    return Boolean(
      canvas.getContext('webgl2'),
    );
  } catch {
    return false;
  }
}

export function isWebGL1Supported(
  canvas: HTMLCanvasElement,
): boolean {
  try {
    return Boolean(
      canvas.getContext('webgl'),
    );
  } catch {
    return false;
  }
}

export function resolveRenderBackend(
  requested: RenderBackend,
  canvas: HTMLCanvasElement,
): Exclude<RenderBackend, 'auto'> {
  if (
    requested === 'webgpu' &&
    isWebGPUSupported()
  ) {
    return 'webgpu';
  }

  if (
    requested === 'webgl2' &&
    isWebGL2Supported(canvas)
  ) {
    return 'webgl2';
  }

  if (
    requested === 'webgl1' &&
    isWebGL1Supported(canvas)
  ) {
    return 'webgl1';
  }

  if (
    requested === 'auto' &&
    isWebGPUSupported()
  ) {
    return 'webgpu';
  }

  if (isWebGL2Supported(canvas)) {
    return 'webgl2';
  }

  if (isWebGL1Supported(canvas)) {
    return 'webgl1';
  }

  throw new Error(
    'No supported renderer was found.',
  );
}
