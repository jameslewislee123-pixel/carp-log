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

// ----------------------------------------------------------------
// datetime-local / date input helpers
// `<input type="datetime-local">` and `<input type="date">` work in
// LOCAL time without a timezone. If we feed them a UTC ISO string
// directly, the browser shows UTC values, and saving back round-trips
// through `new Date(localValue).toISOString()` shifts the timestamp
// by the user's UTC offset on every edit. These helpers take a UTC
// ISO and return a string formatted as the LOCAL wall-clock time so
// the input shows what the user actually saw / saved.
// ----------------------------------------------------------------
function toLocalISO(d: Date): string {
  const offsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offsetMs).toISOString();
}
export function isoToLocalDateTimeInput(iso: string): string {
  return toLocalISO(new Date(iso)).slice(0, 16); // "YYYY-MM-DDTHH:mm"
}
export function isoToLocalDateInput(iso: string): string {
  return toLocalISO(new Date(iso)).slice(0, 10); // "YYYY-MM-DD"
}
export function nowLocalDateTimeInput(): string { return isoToLocalDateTimeInput(new Date().toISOString()); }
export function todayLocalDateInput(): string { return isoToLocalDateInput(new Date().toISOString()); }
export function tomorrowLocalDateInput(): string { return isoToLocalDateInput(new Date(Date.now() + 86400000).toISOString()); }

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
