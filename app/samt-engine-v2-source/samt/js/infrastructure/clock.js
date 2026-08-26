export class SystemClock {
  now() { return new Date().toISOString(); }
}

export class FakeClock {
  constructor(initial) { this.current = new Date(initial); }
  now() { return this.current.toISOString(); }
  set(value) { this.current = new Date(value); return this.now(); }
  advance(milliseconds) { this.current = new Date(this.current.getTime() + Number(milliseconds)); return this.now(); }
  advanceMinutes(minutes) { return this.advance(Number(minutes) * 60000); }
  advanceDays(days) { return this.advance(Number(days) * 86400000); }
}
