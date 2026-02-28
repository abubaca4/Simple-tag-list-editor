class TagsManager {
  constructor() {
    // Начинает асинхронную загрузку конфигурационного файла tags.json
    this.dataPromise = this.startLoadingData();

    this.tagsData = null;
    this.selectedTags = new Map();
    this.categories = new Map();
    this.allTagsInOrder = [];
    this.tagIndexMap = new Map();
    this.knownAsMap = new Map();
    this.altTagSearchMap = new Map();
    this.unrecognizedTags = [];
    this.isHeaderPinned = true;
    this.dom = {};
    this.scrollTicking = false;

    this.themeState = "auto";
    this.themeIcons = { auto: "🌓", dark: "🌙", light: "☀️" };
    this.themeTexts = { auto: "Авто", dark: "Тёмная", light: "Светлая" };

    // Флаг для проверки наличия лимита
    this.hasCharacterLimit = false;

    // Запускает главную последовательность инициализации
    this.initialize();
  }

  // Вспомогательная функция для работы с метаданными кеша в localStorage
  getCacheMetadata(fileName, action = "get", data = {}) {
    const key = `tagsManagerCacheMeta:${fileName}`;
    if (action === "get") {
      try {
        return JSON.parse(localStorage.getItem(key)) || {};
      } catch (e) {
        return {};
      }
    } else if (action === "set") {
      const currentData = this.getCacheMetadata(fileName);
      const newData = {
        cacheMaxAgeHours:
          data.cacheMaxAgeHours || currentData.cacheMaxAgeHours || 24,
        lastSuccessfulFetchTime: data.newContent
          ? Date.now()
          : currentData.lastSuccessfulFetchTime || 0,
      };
      localStorage.setItem(key, JSON.stringify(newData));
      return newData;
    }
    return {};
  }

  // Загружает конфигурационный файл, обрабатывая URL-параметры, кеширование и ошибки
  async startLoadingData() {
    const getParams = () => {
      const p = new URLSearchParams(window.location.search).get("conf");
      return p && !p.endsWith(".json") ? `${p}.json` : p || "tags.json";
    };

    this.configFileName = getParams();

    const fetchFile = async (f, fetchMode) => {
      const options = {
        cache: fetchMode, // 'default' (использует кеш, если свежий) или 'no-cache' (игнорирует кеш)
      };

      const r = await fetch(f, options);
      if (!r.ok) {
        // Если статус 404/500, возвращаем ошибку
        throw new Error(`Файл не найден (статус: ${r.status})`);
      }

      const json = await r.json();

      // Обновляем метаданные после успешного получения (статус 200)
      const cacheMaxAgeHours = json.cacheMaxAgeHours;
      this.getCacheMetadata(f, "set", { cacheMaxAgeHours, newContent: true });

      return json;
    };

    const fileName = getParams();
    let cacheMeta = this.getCacheMetadata(fileName);
    const now = Date.now();
    const lastFetchTime = cacheMeta.lastSuccessfulFetchTime || 0;

    // Расчет требуемого времени обновления
    const maxAgeHours = cacheMeta.cacheMaxAgeHours || 24; // По умолчанию 24 часа
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    const isCacheExpired =
      lastFetchTime === 0 || now - lastFetchTime > maxAgeMs;

    // Определяем режим запроса
    // 'no-cache' заставит браузер обратиться к серверу (для проверки ETag/Last-Modified или получения нового файла).
    // 'default' позволит браузеру использовать кеш, если он свежий по заголовкам Cache-Control/Expires.
    const fetchMode = isCacheExpired ? "no-cache" : "default";

    try {
      return await fetchFile(fileName, fetchMode);
    } catch (e) {
      // Логика резервного варианта 'tags.json'
      if (fileName !== "tags.json") {
        try {
          // Пытаемся загрузить резервный 'tags.json' с принудительной проверкой,
          // чтобы убедиться, что он не устарел, если его будем использовать.
          return await fetchFile("tags.json", "no-cache");
        } catch (fallbackErr) {
          // Если оба файла не найдены/ошибочны, пробрасываем исходную ошибку
          throw e;
        }
      }
      // Пробрасываем ошибку, если исходный файл не 'tags.json' и не найден
      throw e;
    }
  }

  saveStateToStorage() {
    if (!this.configFileName) return;
    const key = `tagsManager_autosave:${this.configFileName}`;
    localStorage.setItem(key, this.dom.input.value);
  }

  loadStateFromStorage() {
    if (!this.configFileName) return null;
    const key = `tagsManager_autosave:${this.configFileName}`;
    return localStorage.getItem(key);
  }

  async initialize() {
    try {
      // Кэширует ссылки на все DOM-элементы
      this.cacheDOM();
      // Устанавливает обработчики для статичных элементов
      this.setupStaticEvents();

      // Ожидает завершения загрузки данных
      try {
        this.tagsData = await this.dataPromise;

        // Проверяем наличие лимита символов в конфигурации
        this.hasCharacterLimit =
          this.tagsData.characterLimit !== undefined &&
          this.tagsData.characterLimit !== null &&
          this.tagsData.characterLimit > 0;

        // Скрываем input-section, если указано в конфигурации
        if (this.tagsData.hideInputSection) {
          this.dom.input.classList.add("util-hidden");
        }

        this.initWebLinks();
      } catch (e) {
        this.handleLoadError(e);
        return;
      }

      // Настройка приложения после загрузки данных
      this.showUI();
      // Инициализирует внутренние структуры данных (Map'ы и индексы)
      this.initCategories();
      // Рендерит HTML-структуру тегов и навигации
      this.render();

      // 1. Пробуем загрузить сохраненное состояние
      const savedState = this.loadStateFromStorage();

      // 2. Если есть сохранение, используем его. Если нет, берем то, что в HTML (value="" у input)
      const initialValue =
        savedState !== null ? savedState : this.dom.input.value;

      if (initialValue) {
        this.parseInput(initialValue, true);
      }

      // Скрываем блок с лимитом, если он не задан
      if (!this.hasCharacterLimit) {
        this.dom.limitBox.parentElement.classList.add("util-hidden");
      } else {
        this.updateLimitDisplay(this.dom.input.value.length);
      }

      // Обновляет состояние всех кнопок и элементов
      this.updateFullState();
      this.updateAlt();
    } catch (e) {
      console.error(e);
      if (!this.dom.error.classList.contains("util-hidden")) return;
      this.error(
        `Критическая ошибка инициализации: ${e.message}`,
        "Критическая ошибка",
      );
    }
  }

  // Обрабатывает и отображает ошибки при загрузке конфигурационного файла
  handleLoadError(e) {
    const fileName =
      new URLSearchParams(window.location.search).get("conf") || "tags.json";
    const isJsonError = e.message.includes("JSON");
    const errorTitle = isJsonError
      ? "Ошибка в формате JSON"
      : "Файл конфигурации не найден";
    const errorText = isJsonError
      ? `Файл **${fileName}** содержит ошибку формата: ${e.message}`
      : `Файл **${fileName}** не найден или недоступен.`;
    this.error(errorText, errorTitle);
  }

  // Кэширует ссылки на все DOM-элементы по ID
  cacheDOM() {
    const id = (x) => document.getElementById(x);
    this.dom = {
      loading: id("loadingMessage"),
      error: id("errorMessage"),
      errDetail: id("errorDetails"),
      errTitle: id("errorTitle"),
      app: id("appContainer"),
      input: id("tagsInput"),
      copyBtn: id("copyBtn"),
      clearBtn: id("clearBtn"),
      unrecWarn: id("unrecognizedTagsWarning"),
      limitBox: id("limitCheckbox"),
      limitDisp: id("limitDisplay"),
      altSection: id("alternativeSection"),
      altOut: id("alternativeOutput"),
      dupBox: id("removeDuplicatesCheckbox"),
      container: id("tagsContainer"),
      nav: id("categoriesNav"),
      navList: id("categoriesNavList"),
      pinBtn: id("pinHeaderButton"),
      header: document.querySelector(".header-panel"),
      main: id("mainContainer"),
      scrollHints: [id("leftScrollHint"), id("rightScrollHint")],
      refSection: id("referenceSection"),
      refToggleBtn: id("toggleReferenceButton"),
      refContent: id("referenceContent"),
      themeToggleBtn: id("themeToggleButton"),
      webLinksNav: id("webLinksNav"),
      themeIcon: document.querySelector(".theme-icon"),
      themeText: document.querySelector(".theme-text"),
    };
  }

  // Вспомогательная функция для создания DOM-элементов
  el(tag, cls = "", text = "", attrs = {}) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text) d.textContent = text;
    Object.entries(attrs).forEach(([k, v]) => d.setAttribute(k, v));
    return d;
  }

  // Инициализирует внутренние структуры данных из tagsData
  initCategories() {
    this.categories.clear();
    this.allTagsInOrder = [];
    this.tagIndexMap.clear();
    this.knownAsMap.clear();
    this.altTagSearchMap.clear();

    this.tagsData.categories.forEach((cat) => {
      const catData = {
        ...cat,
        requirement: cat.requirement || "none",
        overrideRequirementText: cat.overrideRequirementText || "",
        tags: new Map(),
        selectedTags: new Set(),
        orderedTags: [],
        variantGroups: new Map(),
        selectedVariants: new Map(),
        dom: null,
      };

      cat.tags.forEach((t) => {
        const names = Array.isArray(t.name) ? t.name : [t.name];
        const main = names[0];
        if (names.length > 1) catData.variantGroups.set(main, names);

        // Если имя только одно и есть поле image, сохраняем путь. Иначе null.
        const imageUrl = names.length === 1 && t.image ? t.image : null;

        names.forEach((name) => {
          catData.tags.set(name, {
            name,
            mainName: main,
            alternative: t.alternative || "",
            subgroup: t.subgroup || "",
            description: t.description || "",
            image: imageUrl,
            isVariant: name !== main,
            isMainTag: t.main || false,
            knownAs: t.knownAs || [],
            requiredTag: t.requiredTag || null,
          });

          // Индексация тегов для быстрого поиска
          const tagInfo = {
            name,
            mainName: main,
            category: cat.name,
            catData,
            tagConfig: t,
          };
          this.allTagsInOrder.push(tagInfo);
          const currentIndex = this.allTagsInOrder.length - 1;
          const lowerName = name.toLowerCase();

          if (!this.tagIndexMap.has(lowerName))
            this.tagIndexMap.set(lowerName, []);
          this.tagIndexMap.get(lowerName).push(currentIndex);

          if (t.knownAs && Array.isArray(t.knownAs)) {
            t.knownAs.forEach((alias) => {
              const cleanAlias = alias.trim().toLowerCase();
              if (!this.knownAsMap.has(cleanAlias))
                this.knownAsMap.set(cleanAlias, []);
              this.knownAsMap.get(cleanAlias).push(currentIndex);
            });
          }

          if (names.length === 1 && name.includes("/")) {
            this.generateAltNames(name).forEach((altName) => {
              const lowerAlt = altName.toLowerCase();
              if (!this.altTagSearchMap.has(lowerAlt))
                this.altTagSearchMap.set(lowerAlt, []);
              this.altTagSearchMap.get(lowerAlt).push(currentIndex);
            });
          }
        });
      });
      this.categories.set(cat.name, catData);
    });
  }

  initWebLinks() {
    const { webLinksNav } = this.dom;

    if (!webLinksNav) return;

    // Очищаем существующие ссылки
    webLinksNav.innerHTML = "";

    // Проверяем наличие webLinks в конфигурации
    if (
      this.tagsData.webLinks &&
      Array.isArray(this.tagsData.webLinks) &&
      this.tagsData.webLinks.length > 0
    ) {
      // 1. Получаем параметр linkbutton из URL и преобразуем его в массив имен
      const urlParams = new URLSearchParams(window.location.search);
      const linkButtonParam = urlParams.get("linkbutton");
      const allowedButtons = linkButtonParam
        ? linkButtonParam.split(",").map((s) => s.trim())
        : [];

      let addedLinksCount = 0;

      // 2. Фильтруем и создаем ссылки
      this.tagsData.webLinks.forEach((link) => {
        // Логика отображения:
        // - Если fName нет, отображаем всегда.
        // - Если fName есть, проверяем его наличие в параметрах запроса.
        const shouldDisplay =
          !link.fName || allowedButtons.includes(link.fName);

        if (shouldDisplay) {
          const target = link.target || "_blank";
          const linkAttrs = {
            href: link.url,
            target: target,
          };

          if (target === "_blank") {
            linkAttrs["rel"] = "noopener noreferrer";
          }

          const linkElement = this.el(
            "a",
            "web-link-item",
            link.name,
            linkAttrs,
          );
          webLinksNav.appendChild(linkElement);
          addedLinksCount++;
        }
      });

      // Показываем блок только если в итоге была добавлена хотя бы одна ссылка
      if (addedLinksCount > 0) {
        webLinksNav.classList.remove("util-hidden");
      } else {
        webLinksNav.classList.add("util-hidden");
      }
    } else {
      // Скрываем блок, если ссылок нет вообще
      webLinksNav.classList.add("util-hidden");
    }
  }

  // Генерирует альтернативные имена для тегов с косой чертой (например, "A/B C" -> "A C", "B C")
  generateAltNames(name) {
    const parts = name.split(/\s+/).map((p) => p.split("/").filter(Boolean));
    const combine = (arr, index = 0, current = []) => {
      if (index === arr.length) return [current.join(" ").trim()];
      let results = [];
      for (const item of arr[index]) {
        results.push(...combine(arr, index + 1, [...current, item]));
      }
      return results;
    };
    return combine(parts).filter(Boolean);
  }

  // Устанавливает обработчики событий для основных элементов интерфейса
  setupStaticEvents() {
    const {
      input,
      limitBox,
      dupBox,
      pinBtn,
      main,
      header,
      container,
      themeToggleBtn,
      unrecWarn,
      refToggleBtn,
      refContent,
    } = this.dom;

    // Обработка ввода текста. Парсит входную строку и обновляет интерфейс
    input.addEventListener("input", () => {
      unrecWarn.classList.add("util-hidden");
      this.parseInput(input.value, true);
      this.updateUI(false);
    });

    // Обработка клика по кнопке копирования
    this.dom.copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(this.dom.input.value);
      } catch (err) {
        console.error("Ошибка при копировании: ", err);
      }
    });

    // Обработка клика по кнопке очистки
    this.dom.clearBtn.addEventListener("click", () => {
      this.dom.input.value = "";
      unrecWarn.classList.add("util-hidden");
      this.parseInput("", true);
      this.updateUI(false);
      this.saveStateToStorage();
    });

    // Обработка чекбоксов лимита и дубликатов
    limitBox.addEventListener("change", () => {
      this.updateUI(true);
    });
    dupBox.addEventListener("change", () => this.updateAlt());

    // Переключение раздела справки
    refToggleBtn.addEventListener("click", () => {
      const isHidden = refContent.classList.toggle("util-hidden");
      refToggleBtn.textContent = isHidden ? "Важная информация" : "Скрыть";
      if (this.isHeaderPinned) this.updateHeaderOffset();
    });

    // Делегирование клика по кнопкам тегов
    container.addEventListener("click", (e) => {
      const btn = e.target.closest(".tag-button");
      if (!btn) return;
      const catName = btn
        .closest(".category")
        .querySelector(".category-title").textContent;

      const tagName = btn.dataset.name || btn.textContent;

      this.handleTagClick(catName, tagName);
    });

    // Переключение состояния закрепления хедера
    pinBtn.addEventListener("click", () => {
      this.isHeaderPinned = !this.isHeaderPinned;
      this.updatePinState();
      localStorage.setItem("headerPinned", this.isHeaderPinned);
    });

    const savedPinned = localStorage.getItem("headerPinned");
    this.isHeaderPinned = savedPinned !== null ? JSON.parse(savedPinned) : true;

    // Переключение темы
    themeToggleBtn.addEventListener("click", () => this.toggleTheme());
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme) {
      this.themeState = savedTheme;
      this.applyTheme();
    }

    // Оптимизированные обработчики скролла и изменения размера окна
    const updateLayoutDebounced = () => {
      if (!this.scrollTicking) {
        window.requestAnimationFrame(() => {
          this.updateNavVis();
          this.updateScrollHints();
          if (this.isHeaderPinned) this.updateHeaderOffset();
          this.scrollTicking = false;
        });
        this.scrollTicking = true;
      }
    };

    window.addEventListener("resize", updateLayoutDebounced);
    window.addEventListener("scroll", updateLayoutDebounced);

    // Обработка клика вне основных контейнеров (для скролла наверх)
    document.body.addEventListener("click", (e) => {
      if (
        !main.contains(e.target) &&
        !header.contains(e.target) &&
        !e.target.closest(".scroll-hint")
      ) {
        if (window.scrollY > 300)
          window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });

    // Обработка клика по подсказкам скролла
    this.dom.scrollHints.forEach((h) =>
      h.addEventListener("click", () =>
        window.scrollTo({ top: 0, behavior: "smooth" }),
      ),
    );
  }

  // Генерирует HTML-структуру категорий и кнопок тегов
  render() {
    const { container, navList, refSection, refContent, refToggleBtn } =
      this.dom;

    // Очистка контейнеров
    container.innerHTML = "";
    navList.innerHTML = "";

    const referenceHtml = this.tagsData.reference || "";
    if (referenceHtml) {
      refContent.innerHTML = referenceHtml;
      refSection.classList.remove("util-hidden");
      refContent.classList.add("util-hidden");
      refToggleBtn.textContent = "Важная информация";
    } else {
      refSection.classList.add("util-hidden");
    }

    // Создание DocumentFragment для категорий
    const categoriesFragment = document.createDocumentFragment();

    // Создание DocumentFragment для навигации
    const navFragment = document.createDocumentFragment();

    this.categories.forEach((catData, catName) => {
      // Создание DOM-элемента категории
      const catDiv = this.el("div", "category");
      catData.dom = catDiv; // Сохранение ссылки на DOM-элемент категории

      const titleRow = this.el("div", "category-title-container");
      const left = this.el("div", "category-title-left");
      left.append(this.el("div", "category-title", catName));
      if (catData.description) {
        left.append(
          this.el("button", "category-help-button", "?", {
            "data-tooltip": catData.description,
          }),
        );
      }

      const scrollTop = this.el("button", "category-scroll-top", "˄", {
        "aria-label": "Наверх",
      });
      scrollTop.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });

      titleRow.append(left, scrollTop);
      catDiv.append(titleRow, this.el("div", "category-warning util-hidden"));

      const subgroups = this.groupTags(catData);
      subgroups.forEach((tags, subName) => {
        const subDiv = this.el("div", "subgroup");
        if (subName && !subName.startsWith("!")) {
          subDiv.append(this.el("div", "subgroup-title", subName));
        }

        const groupDiv = this.el("div", "tags-group");
        tags.forEach((item) => {
          if (item.type === "variant") {
            const vGroup = this.el("div", "variant-group");
            const vBtns = this.el("div", "variant-buttons");
            item.variants.forEach((t) => vBtns.append(this.createBtn(t)));
            vGroup.append(vBtns);
            if (item.desc)
              vGroup.append(this.el("div", "variant-description", item.desc));
            groupDiv.append(vGroup);
          } else {
            groupDiv.append(this.createBtn(item.tag));
          }
        });
        subDiv.append(groupDiv);
        catDiv.append(subDiv);
      });

      // Добавление категории во фрагмент
      categoriesFragment.appendChild(catDiv);

      // Создание элемента навигации
      const navItem = this.el("button", "category-nav-item", catName);
      navItem.onclick = () => this.scrollToCat(catName);
      navFragment.appendChild(navItem);
    });

    // Одноразовое добавление всех категорий и элементов навигации
    container.appendChild(categoriesFragment);
    navList.appendChild(navFragment);

    this.updateNavVis();
    this.updatePinState();
  }

  // Создает кнопку тега с заданными параметрами
  createBtn(tag) {
    const btnText = tag.image ? "" : tag.name;

    let cssClass = `tag-button util-tag-base${tag.isMainTag ? " main-tag" : ""}`;
    if (tag.image) cssClass += " has-image";

    const btn = this.el("button", cssClass, btnText, {
      "data-tooltip": tag.description || "",
      "data-name": tag.name, // <--- ВАЖНОЕ ИЗМЕНЕНИЕ: сохраняем имя в атрибут
    });

    if (tag.image) {
      const img = document.createElement("img");
      img.src = tag.image;
      img.alt = tag.name;
      btn.appendChild(img);
    }

    if (!tag.domButtons) {
      tag.domButtons = [];
    }
    tag.domButtons.push(btn);

    return btn;
  }

  // Переключает и сохраняет состояние темы (Авто/Темная/Светлая)
  toggleTheme() {
    const states = ["auto", "dark", "light"];
    this.themeState =
      states[(states.indexOf(this.themeState) + 1) % states.length];
    this.applyTheme();
    localStorage.setItem("theme", this.themeState);
  }

  // Применяет выбранную тему к элементу <html> и обновляет иконки
  applyTheme() {
    const html = document.documentElement;
    this.themeState === "auto"
      ? html.removeAttribute("data-theme")
      : html.setAttribute("data-theme", this.themeState);
    if (this.dom.themeIcon)
      this.dom.themeIcon.textContent = this.themeIcons[this.themeState];
    if (this.dom.themeText)
      this.dom.themeText.textContent = this.themeTexts[this.themeState];
    this.dom.themeToggleBtn.title = `Тема: ${this.themeTexts[this.themeState]}`;
  }

  // Группирует теги в подгруппы для рендеринга
  groupTags(catData) {
    const subs = new Map();
    const processed = new Set();

    // Инициализация domButtons для всех тегов
    catData.tags.forEach((tag) => {
      tag.domButtons = [];
    });

    catData.variantGroups.forEach((vars, main) => {
      const tag = catData.tags.get(vars[0]);
      if (!tag) return;
      const s = tag.subgroup || "";
      if (!subs.has(s)) subs.set(s, []);
      subs.get(s).push({
        type: "variant",
        variants: vars.map((v) => catData.tags.get(v)),
        desc: tag.description,
      });
      processed.add(main);
    });

    catData.tags.forEach((tag) => {
      if (tag.isVariant || processed.has(tag.mainName)) return;
      const s = tag.subgroup || "";
      if (!subs.has(s)) subs.set(s, []);
      subs.get(s).push({ type: "single", tag });
    });

    return subs;
  }

  // Обрабатывает клик по кнопке тега
  handleTagClick(catName, tagName) {
    const cat = this.categories.get(catName);
    const tag = cat.tags.get(tagName);
    const main = tag.mainName;

    // Создает снэпшот состояния для возможности отката
    const snapshot = {
      selectedTags: new Set(cat.selectedTags),
      orderedTags: [...cat.orderedTags],
      selectedVariants: new Map(cat.selectedVariants),
    };

    const setSel = (v) => {
      cat.selectedTags.add(main);
      this.selectedTags.set(main, cat.name);
      cat.selectedVariants.set(main, v);
    };
    const delSel = () => {
      cat.selectedTags.delete(main);
      this.selectedTags.delete(main);
      cat.selectedVariants.delete(main);
    };

    // Применяет логику выбора (single, ordered, multiple)
    if (cat.type === "single") {
      const isActive = cat.selectedTags.has(main);
      cat.selectedTags.forEach((m) => {
        this.selectedTags.delete(m);
      });
      cat.selectedTags.clear();
      cat.selectedVariants.clear();

      if (!isActive) setSel(tagName);
    } else if (cat.type === "ordered") {
      if (cat.selectedTags.has(main)) {
        cat.orderedTags = cat.orderedTags.filter((t) => t !== main);
        delSel();
      } else {
        cat.orderedTags.push(main);
        setSel(tagName);
      }
      cat.orderedTags.sort((a, b) => {
        const isAm = cat.tags.get(a).isMainTag,
          isBm = cat.tags.get(b).isMainTag;
        return isAm === isBm ? 0 : isAm ? -1 : 1;
      });
    } else {
      const curVar = cat.selectedVariants.get(main);
      if (cat.selectedTags.has(main) && curVar === tagName) delSel();
      else setSel(tagName);
    }

    // Если тег сейчас выбран и у него есть требование другого тега
    if (cat.selectedTags.has(main) && tag.requiredTag) {
      this.processRequiredTag(cat, tag.requiredTag);
    }

    // ПРЕДВАРИТЕЛЬНАЯ ПРОВЕРКА ЛИМИТА СИМВОЛОВ - только если лимит задан
    if (this.hasCharacterLimit) {
      const newStr = this.generateOutputString();
      const limit = this.tagsData.characterLimit;
      const isLim = this.dom.limitBox.checked;

      if (isLim && newStr.length > limit) {
        // Откат состояния, если лимит превышен
        cat.selectedTags.forEach((m) => this.selectedTags.delete(m));

        cat.selectedTags = snapshot.selectedTags;
        cat.orderedTags = snapshot.orderedTags;
        cat.selectedVariants = snapshot.selectedVariants;

        // Восстановление глобальных ссылок
        cat.selectedTags.forEach((m) => this.selectedTags.set(m, catName));

        // Визуальное уведомление об ошибке
        this.flashLimitError();
        return;
      }
    }

    // Обновление интерфейса
    const newStr = this.generateOutputString();
    this.dom.input.value = newStr;
    this.saveStateToStorage();
    this.updateLimitDisplay(newStr.length);
    this.updateCategoryDOM(cat); // Обновление только одной категории
    this.updateAlt();
  }

  // Обрабатывает логику обязательного связанного тега (поддерживает строку или массив)
  processRequiredTag(cat, requiredTags) {
    // Нормализуем входные данные: превращаем одиночную строку в массив
    const targets = Array.isArray(requiredTags) ? requiredTags : [requiredTags];

    let tagsAdded = false;

    targets.forEach((targetName) => {
      // Ищем тег в текущей категории
      const targetTag = cat.tags.get(targetName);

      // Если тег не найден в этой категории, игнорируем
      if (!targetTag) return;

      const targetMain = targetTag.mainName;

      // Если тег уже выбран, пропускаем (чтобы не сбивать вариант, если он уже выбран)
      if (cat.selectedTags.has(targetMain)) return;

      // Добавляем тег в выбранные
      cat.selectedTags.add(targetMain);
      this.selectedTags.set(targetMain, cat.name);

      // Устанавливаем вариант (имя, которое было указано в requiredTag)
      cat.selectedVariants.set(targetMain, targetName);

      // Если категория упорядоченная, добавляем в список
      if (cat.type === "ordered") {
        cat.orderedTags.push(targetMain);
      }

      tagsAdded = true;
    });

    // Сортируем список только один раз, если были добавлены новые теги и категория упорядоченная
    if (tagsAdded && cat.type === "ordered") {
      cat.orderedTags.sort((a, b) => {
        const isAm = cat.tags.get(a).isMainTag,
          isBm = cat.tags.get(b).isMainTag;
        return isAm === isBm ? 0 : isAm ? -1 : 1;
      });
    }
  }

  // Парсит входную строку из поля ввода, обновляя внутреннее состояние
  parseInput(str, updateInputValue = true) {
    // Очистка предыдущего состояния
    this.selectedTags.clear();
    this.categories.forEach((c) => {
      c.selectedTags.clear();
      c.orderedTags = [];
      c.selectedVariants.clear();
    });
    this.unrecognizedTags = [];

    const rawTags = str
      .split(this.tagsData.separator)
      .map((t) => t.trim())
      .filter(Boolean);

    let lastIdx = -1;
    const recognizedIndices = new Set();

    // Поиск следующего тега по "кольцевому" алгоритму
    const findRingIndex = (indices) => {
      if (!indices) return -1;
      const sorted = [...indices].sort((a, b) => a - b);
      const after = sorted.find((i) => i > lastIdx);
      return after !== undefined ? after : sorted.find((i) => i <= lastIdx);
    };

    // Поиск тега по прямому имени, алиасу или альтернативному имени
    const findTagInMaps = (term) => {
      const maps = [this.tagIndexMap, this.knownAsMap, this.altTagSearchMap];
      for (const map of maps) {
        if (map.has(term)) {
          const idx = findRingIndex(map.get(term));
          if (idx !== -1 && idx !== undefined) return idx;
        }
      }
      return -1;
    };

    rawTags.forEach((tNameOriginal, tagIndex) => {
      const tName = tNameOriginal.toLowerCase();
      const foundIndex = findTagInMaps(tName);

      if (foundIndex !== -1) {
        const info = this.allTagsInOrder[foundIndex];
        const cat = info.catData;
        const main = info.mainName;

        if (cat.type === "single") {
          cat.selectedTags.forEach((m) => this.selectedTags.delete(m));
          cat.selectedTags.clear();
          cat.selectedTags.add(main);
        } else {
          if (!cat.selectedTags.has(main)) cat.selectedTags.add(main);
          if (cat.type === "ordered" && !cat.orderedTags.includes(main))
            cat.orderedTags.push(main);
        }

        cat.selectedVariants.set(main, info.name);
        this.selectedTags.set(main, info.category);
        lastIdx = foundIndex;
        recognizedIndices.add(tagIndex);
      }
    });

    this.unrecognizedTags = rawTags.filter(
      (_, index) => !recognizedIndices.has(index),
    );

    // Перезаписывает поле ввода форматированной строкой
    if (updateInputValue) {
      this.dom.input.value = this.generateOutputString();
    }
  }

  // Генерирует итоговую строку тегов из внутреннего состояния
  generateOutputString() {
    const res = [];
    this.processSelectedTags((name) => res.push(name));
    return res.join(this.tagsData.separator);
  }

  // Итератор по выбранным тегам с учетом порядка и типа категории
  processSelectedTags(callback) {
    // Порядок категорий берется из конфигурации
    this.tagsData.categories.forEach((cfg) => {
      const cat = this.categories.get(cfg.name);
      const run = (main) => {
        const variantName = cat.selectedVariants.get(main) || main;
        const tagObj = cat.tags.get(variantName);
        if (tagObj) callback(variantName, tagObj);
      };

      if (cat.type === "ordered") {
        cat.orderedTags.forEach(run);
      } else if (cat.type === "single") {
        if (cat.selectedTags.size) run([...cat.selectedTags][0]);
      } else {
        cfg.tags.forEach((t) => {
          const main = Array.isArray(t.name) ? t.name[0] : t.name;
          if (cat.selectedTags.has(main)) run(main);
        });
      }
    });
  }

  // Обновляет весь пользовательский интерфейс (поле ввода, кнопки, предупреждения)
  updateUI(updateInputFromState = true) {
    if (updateInputFromState) {
      const str = this.generateOutputString();
      this.dom.input.value = str;
    }

    const len = this.dom.input.value.length;
    this.updateLimitDisplay(len);

    const { unrecWarn } = this.dom;
    if (this.unrecognizedTags.length > 0) {
      unrecWarn.textContent = `Не распознано: ${this.unrecognizedTags.join(", ")}`;
      unrecWarn.classList.remove("util-hidden");
    } else {
      unrecWarn.classList.add("util-hidden");
    }

    this.updateFullState(); // Обновляет все кнопки
    this.updateAlt();
  }

  // Обновляет индикатор лимита символов
  updateLimitDisplay(len) {
    // Если лимит не задан, не обновляем отображение
    if (!this.hasCharacterLimit) return;

    const limit = this.tagsData.characterLimit;
    const isLim = this.dom.limitBox.checked;
    this.dom.limitDisp.textContent = `${len}/${limit}`;
    this.dom.limitDisp.classList.toggle("exceeded", isLim && len > limit);
  }

  // Визуально сигнализирует о превышении лимита символов
  flashLimitError() {
    // Если лимит не задан, не показываем ошибку
    if (!this.hasCharacterLimit) return;

    this.dom.limitDisp.classList.add("exceeded");
    const originalText = this.dom.limitDisp.textContent;
    this.dom.limitDisp.textContent = "ЛИМИТ!";
    setTimeout(() => {
      this.dom.limitDisp.textContent = originalText;
      const len = this.dom.input.value.length;
      const limit = this.tagsData.characterLimit;
      this.dom.limitDisp.classList.toggle(
        "exceeded",
        this.dom.limitBox.checked && len > limit,
      );
    }, 800);
  }

  // Обновляет визуальное состояние кнопок только для одной категории
  updateCategoryDOM(cat) {
    if (!cat.dom) return;
    this.updateButtonsInContainer(cat.dom, cat);
  }

  // Обновляет все кнопки во всех категориях
  updateFullState() {
    this.categories.forEach((cat) => {
      if (cat.dom) this.updateButtonsInContainer(cat.dom, cat);
    });
  }

  // Основная функция для обновления классов кнопок и предупреждений внутри контейнера категории
  updateButtonsInContainer(container, cat) {
    // Более эффективный подход - использование сохранённых ссылок на кнопки
    cat.tags.forEach((tag) => {
      if (tag.domButtons && tag.domButtons.length > 0) {
        tag.domButtons.forEach((btn) => {
          const tName = tag.name; // Используем имя из объекта тега
          const sel =
            cat.selectedTags.has(tag.mainName) &&
            cat.selectedVariants.get(tag.mainName) === tName;

          // Установка класса 'selected'
          if (btn.classList.contains("selected") !== sel) {
            btn.classList.toggle("selected", sel);
          }

          // Установка порядка для ordered-категорий
          if (cat.type === "ordered") {
            if (sel) {
              const order = cat.orderedTags.indexOf(tag.mainName) + 1;
              if (btn.getAttribute("data-order") != order) {
                btn.classList.add("ordered");
                btn.setAttribute("data-order", order);
              }
            } else {
              if (btn.classList.contains("ordered")) {
                btn.classList.remove("ordered");
                btn.removeAttribute("data-order");
              }
            }
          } else {
            if (btn.classList.contains("ordered")) {
              btn.classList.remove("ordered");
              btn.removeAttribute("data-order");
            }
          }
        });
      }
    });

    // Логика предупреждений о требованиях категории
    const warn = container.querySelector(".category-warning");
    let showWarn = false;
    let txt = "";

    if (cat.requirement === "atLeastOne") {
      showWarn = cat.selectedTags.size === 0;
      txt =
        cat.overrideRequirementText || "Необходимо выбрать хотя бы один тег";
    } else if (cat.requirement === "atLeastOneMain") {
      showWarn = ![...cat.selectedTags].some((m) => cat.tags.get(m).isMainTag);
      txt =
        cat.overrideRequirementText ||
        "Необходимо выбрать хотя бы один главный тег";
    }

    if (warn.textContent !== txt) warn.textContent = txt;
    warn.classList.toggle("util-hidden", !showWarn);
  }

  // Генерирует и отображает строку альтернативных тегов
  updateAlt() {
    const alts = [];
    const seen = new Set();

    this.processSelectedTags((_, tagObj) => {
      if (tagObj.alternative) {
        const norm = tagObj.alternative
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");
        // Проверка на дубликаты
        if (!this.dom.dupBox.checked || !seen.has(norm)) {
          alts.push(tagObj.alternative);
          seen.add(norm);
        }
      }
    });

    const s = alts.join(this.tagsData.alternativeSeparator);

    // ВСЕГДА обновляем видимость секции в зависимости от наличия текста
    const shouldBeVisible = s.length > 0;

    // Проверяем, нужно ли изменить видимость
    if (
      shouldBeVisible !== !this.dom.altSection.classList.contains("util-hidden")
    ) {
      this.dom.altSection.classList.toggle("util-hidden", !shouldBeVisible);
    }

    // Обновляем значение только если оно изменилось
    if (this.dom.altOut.value !== s) {
      this.dom.altOut.value = s;
    }

    // Обновление смещения хедера при изменении видимости секции
    if (shouldBeVisible && this.isHeaderPinned) {
      if (!this.scrollTicking) {
        window.requestAnimationFrame(() => this.updateHeaderOffset());
      }
    }
  }

  // Плавно прокручивает страницу до указанной категории
  scrollToCat(name) {
    const el = this.categories.get(name)?.dom;
    if (!el) return;
    const offset = this.isHeaderPinned ? this.dom.header.offsetHeight + 30 : 20;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "smooth" });
  }

  // Устанавливает отступ для основного контента, учитывая высоту закрепленного хедера
  updateHeaderOffset() {
    if (!this.isHeaderPinned) {
      this.dom.main.style.paddingTop = "";
      return;
    }
    const h = this.dom.header.offsetHeight;
    const target = `${h + 55}px`;
    if (this.dom.main.style.paddingTop !== target) {
      this.dom.main.style.paddingTop = target;
    }
  }

  // Обновляет визуальное состояние кнопки закрепления и самого хедера
  updatePinState() {
    const { pinBtn, header, main } = this.dom;
    const act = this.isHeaderPinned;
    pinBtn.classList.toggle("active", act);
    header.classList.toggle("pinned", act);
    main.classList.toggle("has-pinned-header", act);
    pinBtn.textContent = act ? "Закреплено" : "Закрепить окно";
    this.updateNavVis();
    this.updateScrollHints();
    this.updateHeaderOffset();
  }

  // Показывает/скрывает навигацию по категориям в зависимости от необходимости
  updateNavVis() {
    const need =
      this.dom.main.scrollHeight > window.innerHeight || this.isHeaderPinned;
    this.dom.nav.classList.toggle("util-hidden", !need);
  }

  // Показывает/скрывает подсказки скролла наверх
  updateScrollHints() {
    const vis =
      window.innerWidth > this.dom.main.offsetWidth + 200 &&
      window.scrollY > 100;
    this.dom.scrollHints.forEach((h) => h.classList.toggle("visible", vis));
  }

  // Показывает основной интерфейс приложения
  showUI() {
    this.dom.loading.classList.add("util-hidden");
    this.dom.error.classList.add("util-hidden");
    this.dom.app.classList.remove("util-hidden");
  }

  // Отображает сообщение об ошибке
  error(detailText, title = "Ошибка загрузки конфигурации") {
    this.dom.loading.classList.add("util-hidden");
    this.dom.errTitle.textContent = title;
    this.dom.errDetail.innerHTML = detailText.replace(
      /\*\*(.*?)\*\*/g,
      "<code>$1</code>",
    );
    this.dom.error.classList.remove("util-hidden");
    this.dom.app.classList.add("util-hidden");
  }
}

// Инициализация при полной загрузке DOM
document.addEventListener("DOMContentLoaded", () => new TagsManager());
