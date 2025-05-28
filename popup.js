document.getElementById("login").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "login" }, (response) => {
    if (response.success) {
      alert("Please complete login in the new tab.");
    } else {
      alert("Login failed.");
    }
  });
}); 