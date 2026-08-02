export let modalOpen = false;

export function openModal(innerHtml, onSave, saveLabel){
  modalOpen = true;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const label = saveLabel || 'Save';
  const dangerStyle = saveLabel === 'Delete' ? ' style="background:var(--rust);"' : '';
  overlay.innerHTML = `<div class="modal">${innerHtml}
    <div class="modal-actions">
      <button class="btn-ghost" id="modalCancel">Cancel</button>
      <button class="btn-primary" id="modalSave"${dangerStyle}>${label}</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => { modalOpen = false; document.body.removeChild(overlay); };
  overlay.onclick = (e) => { if(e.target === overlay) close(); };
  overlay.querySelector('#modalCancel').onclick = close;
  overlay.querySelector('#modalSave').onclick = async () => {
    const ok = await onSave();
    if(ok !== false) close();
  };
}
