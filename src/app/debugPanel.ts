// Runtime MonetizationConfig editor for tuning (spec §9.6). Enabled with ?debug=1.
import type { MonetizationConfig } from '../monetization/config';

export function mountDebugPanel(config: MonetizationConfig, extra: Record<string, () => string>): void {
  const panel = document.createElement('div');
  panel.id = 'debug-panel';
  const title = document.createElement('div');
  title.textContent = '⚙ MonetizationConfig';
  title.style.fontWeight = '700';
  title.style.marginBottom = '6px';
  panel.appendChild(title);

  for (const key of Object.keys(config) as Array<keyof MonetizationConfig>) {
    const row = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = key;
    const input = document.createElement('input');
    input.type = 'number';
    input.value = String(config[key]);
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) (config as unknown as Record<string, number>)[key] = v;
    });
    row.append(span, input);
    panel.appendChild(row);
  }

  const status = document.createElement('div');
  status.style.marginTop = '8px';
  status.style.color = '#9aa3c7';
  panel.appendChild(status);
  window.setInterval(() => {
    status.innerHTML = Object.entries(extra)
      .map(([k, fn]) => `${k}: ${fn()}`)
      .join('<br>');
  }, 1000);

  document.body.appendChild(panel);
}
