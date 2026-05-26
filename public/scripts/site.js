const menuButton = document.querySelector(".menu-toggle");
const nav = document.querySelector(".site-nav");

if (menuButton && nav) {
  menuButton.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(open));
  });
}

const searchInput = document.querySelector("[data-article-search]");
const archiveCards = [...document.querySelectorAll(".archive-card")];

if (searchInput && archiveCards.length) {
  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim().toLowerCase();

    archiveCards.forEach((card) => {
      const text = `${card.dataset.search || ""} ${card.textContent}`.toLowerCase();
      card.hidden = Boolean(query) && !text.includes(query);
    });
  });
}
