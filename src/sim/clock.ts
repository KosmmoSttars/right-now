// Simulation time: real time by default, or faster, slower, backwards, paused.

/** Seconds of simulation per real second. */
export const WARPS = [-31_557_600, -2_592_000, -604_800, -86_400, -3600, -60, 1, 60, 3600, 86_400, 604_800, 2_592_000, 31_557_600] as const;

type Listener = () => void;

export class SimClock {
  private anchorReal = performance.now();
  private anchorSim = Date.now();
  private _warp = 1;
  private _paused = false;
  /** Bumped on every jump, so consumers can drop cached state. */
  epoch = 0;
  private listeners = new Set<Listener>();

  get warp(): number {
    return this._warp;
  }

  get paused(): boolean {
    return this._paused;
  }

  now(): number {
    if (this._paused) return this.anchorSim;
    return this.anchorSim + (performance.now() - this.anchorReal) * this._warp;
  }

  /** Live means real time at real speed, the default state. */
  isLive(): boolean {
    return !this._paused && this._warp === 1 && Math.abs(this.now() - Date.now()) < 5000;
  }

  private reanchor(sim = this.now()): void {
    this.anchorSim = sim;
    this.anchorReal = performance.now();
  }

  setWarp(w: number): void {
    this.reanchor();
    this._warp = w;
    this._paused = false;
    this.emit();
  }

  setPaused(p: boolean): void {
    this.reanchor();
    this._paused = p;
    this.emit();
  }

  jump(ms: number): void {
    this.reanchor(ms);
    this.epoch++;
    this.emit();
  }

  goLive(): void {
    this._warp = 1;
    this._paused = false;
    this.reanchor(Date.now());
    this.epoch++;
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
