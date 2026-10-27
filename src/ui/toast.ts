/** Shows short messages that fade after a few seconds; a new message replaces the old one. */
export function createToast(el: HTMLElement): (message: string, seconds?: number) => void {
  let timer = 0;
  return (message, seconds = 3) => {
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(timer);
    timer = window.setTimeout(() => el.classList.remove('visible'), seconds * 1000);
  };
}
