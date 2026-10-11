export type RenderBackend = 'webgpu' | 'webgl1';

export function isWebGPUSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'gpu' in navigator
  );
}

export function isWebGL1Supported(
  canvas: HTMLCanvasElement,
): boolean {
  try {
    return Boolean(canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export function resolveRenderBackend(
  requested: RenderBackend,
  canvas: HTMLCanvasElement,
): RenderBackend {
  if (requested === 'webgpu') {
    if (isWebGPUSupported()) {
      return 'webgpu';
    }

    if (isWebGL1Supported(canvas)) {
      return 'webgl1';
    }
  }

  if (requested === 'webgl1') {
    if (isWebGL1Supported(canvas)) {
      return 'webgl1';
    }

    if (isWebGPUSupported()) {
      return 'webgpu';
    }
  }

  throw new Error(
    'Neither WebGPU nor WebGL 1 is available.',
  );
}