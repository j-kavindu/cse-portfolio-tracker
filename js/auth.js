/* Firebase Auth with persistent Google sign-in. */
(function (global) {
  "use strict";
  let sdk, auth, callback, currentUser = null;
  const configured = () => global.Cloud.isConfigured();
  function canonical(user) {
    return user && { id: user.uid, uid: user.uid, email: user.email, name: user.displayName || user.email, picture: user.photoURL || "" };
  }
  function init(cb) {
    callback = cb;
    if (!configured()) return renderButton(document.getElementById("google-signin-button"));
    // module bootstrap supplies the SDK asynchronously.
    if (auth) sdk.onAuthStateChanged(auth, onState, onError);
  }
  function setup(modules, instance) { sdk = modules; auth = instance; sdk.onAuthStateChanged(auth, onState, onError); }
  function onState(user) {
    currentUser = canonical(user);
    if (user) callback && callback(currentUser);
    else { document.getElementById("app-shell").hidden = true; document.getElementById("login-screen").hidden = false; }
  }
  function onError(error) { showError(error); }
  function showError(e) {
    const el = document.getElementById("auth-error");
    if (el) el.textContent = e.message || String(e);
  }
  async function signIn() {
    if (!auth) return;
    try { await sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider()); }
    catch (e) { showError(e); }
  }
  function renderButton(el) {
    el.innerHTML = "";
    const button = document.createElement("button");
    button.type = "button"; button.className = "btn btn-primary";
    button.textContent = configured() ? "Sign in with Google" : "Continue in local demo";
    button.addEventListener("click", configured() ? signIn : () => {
      currentUser = { id: "local-demo", uid: "local-demo", email: "demo@local", name: "Demo User", picture: "", demo: true };
      callback && callback(currentUser);
    });
    el.append(button);
  }
  async function signOut() { currentUser = null; if (auth) await sdk.signOut(auth); location.reload(); }
  global.Auth = { init, setup, renderButton, signIn, getUser: () => currentUser, signOut, isConfigured: configured };
})(window);
