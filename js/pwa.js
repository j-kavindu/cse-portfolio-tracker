(function () {
  let promptEvent;
  const button = document.getElementById("install-app");
  const hint = document.getElementById("ios-install-hint");
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  function update() {
    button.hidden = !promptEvent || standalone();
    hint.hidden = !ios || standalone() || sessionStorage.getItem("ios-install-dismissed") === "1";
  }
  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); promptEvent = event; update(); });
  button.addEventListener("click", async () => { if (!promptEvent) return; const event = promptEvent; promptEvent = null; update(); await event.prompt(); await event.userChoice; });
  window.addEventListener("appinstalled", () => { promptEvent = null; update(); });
  document.getElementById("dismiss-ios-hint").addEventListener("click", () => { sessionStorage.setItem("ios-install-dismissed", "1"); update(); });
  update();
})();
