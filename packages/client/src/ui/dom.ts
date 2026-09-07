export type Child = Node | string | null | undefined | false;

/** Tiny DOM helper — the UI is small enough that a framework would cost more than it saves. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Omit<HTMLElementTagNameMap[K], 'style' | 'dataset'>> & {
    class?: string;
    style?: Partial<CSSStyleDeclaration>;
    dataset?: Record<string, string>;
    onClick?: (event: MouseEvent) => void;
  } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: className, style, dataset, onClick, ...rest } = props;
  if (className) node.className = className;
  if (style) Object.assign(node.style, style);
  if (dataset) for (const [key, value] of Object.entries(dataset)) node.dataset[key] = value;
  if (onClick) node.addEventListener('click', onClick as EventListener);
  Object.assign(node, rest);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.firstChild.remove();
}

export function button(label: string, onClick: () => void, variant: 'primary' | 'ghost' | 'danger' = 'ghost'): HTMLButtonElement {
  return el('button', { class: `kc-btn kc-btn--${variant}`, onClick, dataset: { ui: 'true' } }, label);
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
