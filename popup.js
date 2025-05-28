document.getElementById("login").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "login" }, (response) => {
    if (response.success) {
      alert("Please complete login in the new tab.");
    } else {
      alert("Login failed.");
    }
  });
});

function populateFilteredUsersTable() {
  chrome.storage.local.get({ filteredUsers: [] }, ({ filteredUsers }) => {
    const tbody = document.querySelector("#filtered-users-table tbody");
    tbody.innerHTML = "";
    filteredUsers.forEach(user => {
      const tr = document.createElement("tr");
      const tdUser = document.createElement("td");
      const tdReason = document.createElement("td");
      const tdPost = document.createElement("td");
      const a = document.createElement("a");
      a.href = user.url;
      a.textContent = user.username;
      a.target = "_blank";
      tdUser.appendChild(a);
      tdReason.textContent = user.reason;
      if (user.postUrl) {
        const postLink = document.createElement("a");
        postLink.href = user.postUrl;
        postLink.textContent = user.postTitle || user.postUrl;
        postLink.target = "_blank";
        tdPost.appendChild(postLink);
      } else {
        tdPost.textContent = "-";
      }
      tr.appendChild(tdUser);
      tr.appendChild(tdReason);
      tr.appendChild(tdPost);
      tbody.appendChild(tr);
    });
  });
}

document.addEventListener("DOMContentLoaded", populateFilteredUsersTable); 