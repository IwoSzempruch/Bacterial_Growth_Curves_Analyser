export async function svgToPngBlob(svg: SVGSVGElement): Promise<Blob> {
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svg);
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  const width = svg.width.baseVal.value;
  const height = svg.height.baseVal.value;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (e) => reject(e);
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context not available');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b as Blob), 'image/png'));
  return blob;
}

function cloneWithInlineStyles(el: Element): Element {
  const clone = el.cloneNode(false) as Element;
  const computed = window.getComputedStyle(el as Element);
  const cssText = Array.from(computed)
    .map((prop) => `${prop}:${computed.getPropertyValue(prop)};`)
    .join('');
  if (cssText) {
    clone.setAttribute('style', cssText);
  }
  if (el instanceof SVGElement && !(clone as Element).getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  el.childNodes.forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE) {
      clone.appendChild(cloneWithInlineStyles(child as Element));
    } else if (child.nodeType === Node.TEXT_NODE) {
      clone.appendChild(child.cloneNode(true));
    }
  });
  return clone;
}

export async function elementToPngBlob(
  node: HTMLElement | SVGElement,
  options?: { scale?: number; background?: string }
): Promise<Blob | null> {
  if (typeof window === 'undefined') return null;
  const rect = node.getBoundingClientRect?.();
  const width = Math.max(1, Math.round(rect?.width || 0));
  const height = Math.max(1, Math.round(rect?.height || 0));
  if (!width || !height) return null;
  const scale = options?.scale ?? Math.min(3, Math.max(1.5, window.devicePixelRatio || 2));

  // Fast path for SVG roots – avoids nested foreignObject issues
  if (node instanceof SVGSVGElement) {
    const svgClone = cloneWithInlineStyles(node) as SVGSVGElement;
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgClone.setAttribute('width', `${width * scale}`);
    svgClone.setAttribute('height', `${height * scale}`);
    if (!svgClone.getAttribute('viewBox')) {
      svgClone.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgClone);
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    return await new Promise<Blob | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          const background = options?.background ?? '#ffffff';
          if (background !== 'transparent') {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => resolve(blob), 'image/png');
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  const cloned = cloneWithInlineStyles(node);
  const wrapper = document.createElement('div');
  wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrapper.style.margin = '0';
  wrapper.style.padding = '0';
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.appendChild(cloned as Node);

  const serializer = new XMLSerializer();
  const foreign = serializer.serializeToString(wrapper);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%">${foreign}</foreignObject></svg>`;
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  return await new Promise<Blob | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        const background = options?.background ?? '#ffffff';
        if (background !== 'transparent') {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob), 'image/png');
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export async function saveToDirectory(blob: Blob, name: string, dirHandle: FileSystemDirectoryHandle) {
  // File System Access API (Chromium)
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}
