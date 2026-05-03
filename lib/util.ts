export const totalOz = (lbs: number, oz: number) => (lbs || 0) * 16 + (oz || 0);

export const formatWeight = (lbs: number, oz: number) => {
  if (!lbs && !oz) return '0lb';
  if (!oz) return `${lbs}lb`;
  return `${lbs}lb ${oz}oz`;
};

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `Today, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateRange(startISO: string, endISO: string): string {
  const s = new Date(startISO), e = new Date(endISO);
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  if (sameMonth) return `${s.getDate()}–${e.getDate()} ${e.toLocaleString('default', { month: 'short' })} ${e.getFullYear()}`;
  return `${s.toLocaleDateString([], { day: 'numeric', month: 'short' })} – ${e.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1200;
        let { width, height } = img;
        if (width > height && width > maxDim) { height = height * (maxDim / width); width = maxDim; }
        else if (height > maxDim) { width = width * (maxDim / height); height = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject;
      img.src = e.target!.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function sendTelegram(notify: { token: string | null; chat_id: string | null; enabled: boolean } | null, text: string) {
  if (!notify?.enabled || !notify?.token || !notify?.chat_id) return;
  try {
    await fetch(`https://api.telegram.org/bot${notify.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: notify.chat_id, text, parse_mode: 'HTML' }),
    });
  } catch {}
}
