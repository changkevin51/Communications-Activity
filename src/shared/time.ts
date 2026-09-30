export type ClockSample = { offset: number; rtt: number };

export function clockSample(sentAt: number, receivedAt: number, serverNow: number): ClockSample {
  const rtt = receivedAt - sentAt;
  return { rtt, offset: serverNow + rtt / 2 - receivedAt };
}

export function bestOffset(samples: ClockSample[]): number {
  if (!samples.length) return 0;
  return samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
}
