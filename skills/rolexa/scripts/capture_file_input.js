// Run in the user's Chrome on a resume / CV upload step, BEFORE clicking the "Upload" button.
// Captures the file input the site creates on click, so file_upload can target it without opening the OS picker.
(() => {
  document.getElementById('rolexa-file')?.remove();
  window.__rolexaFile = null;
  if (!window.__rolexaOrigClick) window.__rolexaOrigClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type === 'file') {
      this.id = 'rolexa-file';
      if (!this.isConnected) { this.style.display = 'none'; document.body.appendChild(this); }
      window.__rolexaFile = this;
      return;
    }
    return window.__rolexaOrigClick.call(this);
  };
  window.__rolexaRestoreClick = () => { if (window.__rolexaOrigClick) HTMLInputElement.prototype.click = window.__rolexaOrigClick; return 'restored'; };
  return 'patched: click the upload button, then find the type=file input and call file_upload; then run window.__rolexaRestoreClick()';
})()
