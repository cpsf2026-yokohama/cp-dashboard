/** Deterministic ribbons: navy tips, cyan roots and dark folds like the event banner. */
export function drawBlueFlame(ctx: CanvasRenderingContext2D, width: number, height: number, time: number) {
  ctx.clearRect(0, 0, width, height);
  const unit = Math.min(Math.max(width / 1200, 0.75), 1.6);
  const count = Math.ceil(width / (90 * unit)) + 2;

  for (let layer = 0; layer < 3; layer++) {
    for (let i = -1; i < count; i++) {
      const seed = i * 2.399 + layer * 7.13;
      const variation = (Math.sin(seed * 3.7) + 1) / 2;
      const flameHeight = height * (0.32 + variation * 0.6) * (1 - layer * 0.21);
      const baseX = i * width / (count - 2) + layer * 37 * unit;
      const baseWidth = (38 + variation * 32) * unit;
      const points: { x: number; y: number; half: number }[] = [];
      for (let step = 0; step <= 36; step++) {
        const p = step / 36;
        const sway = Math.sin(p * 7.5 - time * 0.85 + seed) * 22
          + Math.sin(p * 13 - time * 1.1 + seed * 2) * 8;
        const lean = Math.sin(seed + time * 0.3) * 32 * p;
        const taper = Math.pow(1 - p, 1.35);
        points.push({
          x: baseX + (sway * p + lean) * unit,
          y: height + 12 - p * flameHeight * (0.94 + 0.06 * Math.sin(time + seed)),
          half: baseWidth * taper * (0.74 + 0.26 * Math.sin(p * 10 - time + seed)),
        });
      }
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x - point.half, point.y);
        else ctx.lineTo(point.x - point.half, point.y);
      });
      for (let j = points.length - 1; j >= 0; j--) {
        const point = points[j]!;
        ctx.lineTo(point.x + point.half * (0.75 + 0.25 * Math.cos(j * 0.25 + seed)), point.y);
      }
      ctx.closePath();
      const fill = ctx.createLinearGradient(baseX - baseWidth, height, baseX + baseWidth * 0.3, height - flameHeight);
      if (layer === 0) {
        fill.addColorStop(0, '#123647');
        fill.addColorStop(0.32, '#104777');
        fill.addColorStop(0.65, '#0a205d');
        fill.addColorStop(1, '#080d31');
      } else {
        fill.addColorStop(0, layer === 1 ? '#225b68' : '#071522');
        fill.addColorStop(0.25, layer === 1 ? '#246577' : '#123c56');
        fill.addColorStop(0.55, '#0b355d');
        fill.addColorStop(1, '#081334');
      }
      ctx.fillStyle = fill;
      ctx.fill();

      // A translucent highlight follows one edge, leaving a dark hollow inside.
      const edge = ctx.createLinearGradient(baseX - baseWidth, height, baseX + baseWidth, height - flameHeight * 0.6);
      edge.addColorStop(0, 'rgba(73, 158, 172, 0.02)');
      edge.addColorStop(0.45, 'rgba(47, 139, 169, 0.28)');
      edge.addColorStop(0.6, 'rgba(12, 37, 83, 0)');
      edge.addColorStop(1, 'rgba(0, 2, 10, 0.5)');
      ctx.fillStyle = edge;
      ctx.fill();
    }
  }

  // Low, interwoven folds anchor the flames instead of a flat glowing stripe.
  for (let fold = 0; fold < 5; fold++) {
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width + 8; x += 8) {
      const y = height - (14 + fold * 9 + Math.sin(x / (110 * unit) + time * 0.45 + fold * 0.8) * 12
        + Math.sin(x / (57 * unit) - time * 0.3 + fold) * 5) * unit;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, height - (40 + fold * 8) * unit, 0, height);
    fill.addColorStop(0, 'rgba(32, 100, 132, 0.45)');
    fill.addColorStop(0.28, 'rgba(8, 37, 70, 0.8)');
    fill.addColorStop(1, '#03070d');
    ctx.fillStyle = fill;
    ctx.fill();
  }
}
