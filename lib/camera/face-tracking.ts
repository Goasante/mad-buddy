export type NormalizedFaceBounds = { x: number; y: number; width: number; height: number };

export type FaceTrackingResult = {
  bounds: NormalizedFaceBounds;
  confidence: number;
  capturedAt: number;
};

export interface FaceTrackingEngine {
  readonly available: boolean;
  detect(source: CanvasImageSource): Promise<FaceTrackingResult[]>;
  close(): void;
}

/**
 * The engine boundary is intentionally platform-neutral and returns no-op until a
 * privacy-reviewed tracking adapter is shipped. No landmarks leave memory or enter
 * the edit document.
 */
export async function loadFaceTrackingEngine(): Promise<FaceTrackingEngine> {
  return {
    available: false,
    async detect() {
      return [];
    },
    close() {
      // No resources in the no-op adapter.
    }
  };
}

export function selectPrimaryFace(results: FaceTrackingResult[]): FaceTrackingResult | null {
  return results
    .filter((result) => result.confidence >= 0.5 && validBounds(result.bounds))
    .sort((left, right) => area(right.bounds) - area(left.bounds))[0] ?? null;
}

function area(bounds: NormalizedFaceBounds) {
  return bounds.width * bounds.height;
}

function validBounds(bounds: NormalizedFaceBounds) {
  return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    && bounds.x >= 0
    && bounds.y >= 0
    && bounds.width > 0
    && bounds.height > 0
    && bounds.x + bounds.width <= 1
    && bounds.y + bounds.height <= 1;
}

