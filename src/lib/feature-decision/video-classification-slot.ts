import "server-only";

type ReleaseSlot = () => void;
type VideoSlot = {
  busy: boolean;
  waiters: Array<(release: ReleaseSlot) => void>;
};

// Share the slot across server bundles in the same process.
const processState = globalThis as typeof globalThis & {
  autoTagVideoClassificationSlot?: VideoSlot;
};
const slot = (processState.autoTagVideoClassificationSlot ??= { busy: false, waiters: [] });

export function isVideoClassificationBusy() {
  return slot.busy;
}

function releaseSlot() {
  const next = slot.waiters.shift();
  if (next) next(releaseSlot);
  else slot.busy = false;
}

export function tryAcquireVideoClassificationSlot(): ReleaseSlot | undefined {
  if (slot.busy) return;
  slot.busy = true;
  return releaseSlot;
}

export async function withVideoClassificationSlot<T>(classify: () => Promise<T>): Promise<T> {
  const release =
    tryAcquireVideoClassificationSlot() ??
    (await new Promise<ReleaseSlot>((resolve) => slot.waiters.push(resolve)));
  try {
    return await classify();
  } finally {
    release();
  }
}
