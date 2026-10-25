
    function initVenueStatePicker() {
      const field = document.getElementById("venueRequestStateField");
      const select = document.getElementById("venueRequestState");
      const button = document.getElementById("venueRequestStateButton");
      const text = document.getElementById("venueRequestStateText");
      const list = document.getElementById("venueRequestStateOptions");
      const error = document.getElementById("venueRequestStateError");
      if (!field || !select || !button || !text || !list || !error) return;
      const states = [...select.options].filter(option => option.value && !option.disabled);
      let activeIndex = 0;
      let search = "";
      let lastTyped = 0;
      const options = states.map(stateOption => {
        const option = document.createElement("div");
        option.id = `venue-state-${stateOption.value}`;
        option.dataset.state = stateOption.value;
        option.setAttribute("role", "option");
        option.setAttribute("aria-label", stateOption.getAttribute("aria-label") || stateOption.value);
        option.textContent = stateOption.value;
        list.append(option);
        return option;
      });

      function sync() {
        text.textContent = select.value || "Select state";
        options.forEach(option => option.setAttribute("aria-selected", String(option.dataset.state === select.value)));
        if (select.value) {
          error.hidden = true;
          button.removeAttribute("aria-invalid");
          button.removeAttribute("aria-describedby");
        }
      }
      function highlight(index) {
        activeIndex = (index + options.length) % options.length;
        options.forEach((option, i) => option.classList.toggle("is-active", i === activeIndex));
        const option = options[activeIndex];
        button.setAttribute("aria-activedescendant", option.id);
        if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
        else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
          list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
        }
      }
      function open() {
        sync();
        list.hidden = false;
        button.setAttribute("aria-expanded", "true");
        highlight(Math.max(0, states.findIndex(option => option.value === select.value)));
      }
      function close() {
        list.hidden = true;
        button.setAttribute("aria-expanded", "false");
        button.removeAttribute("aria-activedescendant");
        search = "";
      }
      function choose(index) {
        const value = states[index]?.value;
        if (!value) return;
        const changed = select.value !== value;
        select.value = value;
        sync();
        close();
        button.focus({ preventScroll: true });
        if (changed) {
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }

      button.addEventListener("click", () => list.hidden ? open() : close());
      button.addEventListener("keydown", event => {
        const key = event.key;
        if (key === "Tab") { close(); return; }
        if (key === "Escape") {
          if (!list.hidden) { event.preventDefault(); event.stopPropagation(); close(); }
          return;
        }
        if (key === "Enter" || key === " ") {
          event.preventDefault();
          if (list.hidden) open();
          else choose(activeIndex);
          return;
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
          event.preventDefault();
          const wasClosed = list.hidden;
          if (wasClosed) open();
          if (key === "Home") highlight(0);
          else if (key === "End") highlight(options.length - 1);
          else if (!wasClosed) highlight(activeIndex + (key === "ArrowDown" ? 1 : -1));
          return;
        }
        if (!event.ctrlKey && !event.metaKey && !event.altKey && /^[a-z]$/i.test(key)) {
          event.preventDefault();
          if (list.hidden) open();
          const now = Date.now();
          search = (now - lastTyped < 700 ? search : "") + key.toUpperCase();
          lastTyped = now;
          let index = states.findIndex(option => option.value.startsWith(search));
          if (index < 0) {
            search = key.toUpperCase();
            index = states.findIndex(option => option.value.startsWith(search));
          }
          if (index >= 0) highlight(index);
        }
      });
      // Keep focus on the combobox while clicking; touch scrolling remains native.
      list.addEventListener("mousedown", event => event.preventDefault());
      list.addEventListener("click", event => {
        const option = event.target.closest("[data-state]");
        if (option && list.contains(option)) choose(states.findIndex(state => state.value === option.dataset.state));
      });
      document.addEventListener("pointerdown", event => {
        if (!field.contains(event.target)) close();
      });
      field.addEventListener("focusout", event => {
        if (!field.contains(event.relatedTarget)) close();
      });
      select.addEventListener("change", sync);
      select.addEventListener("invalid", event => {
        event.preventDefault();
        error.hidden = false;
        button.setAttribute("aria-invalid", "true");
        button.setAttribute("aria-describedby", error.id);
        if (select.form?.querySelector(":invalid") === select) button.focus();
      });
      select.form?.addEventListener("reset", () => {
        close();
        error.hidden = true;
        button.removeAttribute("aria-invalid");
        button.removeAttribute("aria-describedby");
        queueMicrotask(sync);
      });
      field.classList.add("is-enhanced");
      select.tabIndex = -1;
      select.setAttribute("aria-hidden", "true");
      document.getElementById("venueRequestStateLabel").htmlFor = button.id;
      button.hidden = false;
      sync();
    }
    initVenueStatePicker();
