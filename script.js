class TagsManager {
    constructor() {
        this.tagsData = null;
        this.selectedTags = new Map();
        this.categories = new Map();
        this.variantTags = new Map(); // Карта для хранения связи вариантов с основным тегом
        this.initialize();
    }

    async initialize() {
        await this.loadTagsData();
        this.setupEventListeners();
        this.setupInitialState();
        this.renderTags();
        this.parseInitialInput();
        this.updateLimitDisplay();
        this.updateAlternativeSection();
    }

    async loadTagsData() {
        try {
            const response = await fetch('tags.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.tagsData = await response.json();
            this.initializeCategories();
        } catch (error) {
            console.error('Ошибка загрузки tags.json:', error);
            // Fallback данные на случай ошибки
            this.tagsData = this.getFallbackData();
            this.initializeCategories();
        }
    }

    setupInitialState() {
        // Автоматически включаем чекбокс ограничения длины
        const limitCheckbox = document.getElementById('limitCheckbox');
        limitCheckbox.checked = true;
    }

    parseInitialInput() {
        const input = document.getElementById('tagsInput');
        const initialValue = input.value.trim();

        if (initialValue) {
            // Если в поле ввода уже есть значение, парсим его
            this.parseInputString(initialValue);
        } else {
            // Если поле пустое, устанавливаем пустое состояние
            this.clearAllSelections();
        }

        // Обновляем отображение
        this.updateDisplay();
    }

    getFallbackData() {
        return {
            "separator": ", ",
            "alternativeSeparator": " | ",
            "characterLimit": 100,
            "categories": [
                {
                    "name": "Жанры",
                    "type": "standard",
                    "tags": [
                        {
                            "name": "экшен",
                            "alternative": "action",
                            "subgroup": "Основные",
                            "description": "Динамичные сцены и битвы"
                        },
                        {
                            "name": "романтика",
                            "alternative": "romance",
                            "subgroup": "Основные",
                            "description": "Истории о любви и отношениях"
                        }
                    ]
                }
            ]
        };
    }

    initializeCategories() {
        this.categories.clear();
        this.variantTags.clear();

        this.tagsData.categories.forEach(category => {
            const categoryData = {
                name: category.name,
                type: category.type,
                tags: new Map(),
                selectedTags: new Set(),
                orderedTags: [],
                variantGroups: new Map() // Для хранения групп вариаций
            };

            category.tags.forEach(tag => {
                const names = Array.isArray(tag.name) ? tag.name : [tag.name];
                const mainName = names[0]; // Первое имя - основное

                // Сохраняем все варианты имен
                names.forEach(name => {
                    categoryData.tags.set(name, {
                        name: name,
                        mainName: mainName, // Ссылка на основное имя
                        alternative: tag.alternative || '',
                        subgroup: tag.subgroup || '',
                        description: tag.description || '',
                        isVariant: name !== mainName
                    });

                    // Сохраняем связь варианта с основным тегом
                    this.variantTags.set(name, mainName);
                });

                // Сохраняем информацию о группе вариаций
                if (names.length > 1) {
                    categoryData.variantGroups.set(mainName, names);
                }
            });

            this.categories.set(category.name, categoryData);
        });
    }

    setupEventListeners() {
        const tagsInput = document.getElementById('tagsInput');
        const limitCheckbox = document.getElementById('limitCheckbox');
        const removeDuplicatesCheckbox = document.getElementById('removeDuplicatesCheckbox');

        tagsInput.addEventListener('input', () => {
            this.parseInputString(tagsInput.value);
            this.updateDisplay();
        });

        limitCheckbox.addEventListener('change', () => {
            this.updateDisplay();
        });

        removeDuplicatesCheckbox.addEventListener('change', () => {
            this.updateAlternativeSection();
        });
    }

    renderTags() {
        const container = document.getElementById('tagsContainer');
        container.innerHTML = '';

        this.categories.forEach((categoryData, categoryName) => {
            const categoryElement = this.createCategoryElement(categoryName, categoryData);
            container.appendChild(categoryElement);
        });
    }

    createCategoryElement(categoryName, categoryData) {
        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'category';

        const title = document.createElement('div');
        title.className = 'category-title';
        title.textContent = categoryName;
        categoryDiv.appendChild(title);

        const subgroups = this.groupTagsBySubgroup(categoryData);

        subgroups.forEach((tags, subgroupName) => {
            if (subgroupName) {
                const subgroupDiv = document.createElement('div');
                subgroupDiv.className = 'subgroup';

                const subgroupTitle = document.createElement('div');
                subgroupTitle.className = 'subgroup-title';
                subgroupTitle.textContent = subgroupName;
                subgroupDiv.appendChild(subgroupTitle);

                const tagsGroup = this.createTagsGroup(tags, categoryName, categoryData);
                subgroupDiv.appendChild(tagsGroup);
                categoryDiv.appendChild(subgroupDiv);
            } else {
                const tagsGroup = this.createTagsGroup(tags, categoryName, categoryData);
                categoryDiv.appendChild(tagsGroup);
            }
        });

        return categoryDiv;
    }

    groupTagsBySubgroup(categoryData) {
        const subgroups = new Map();
        const processedMainNames = new Set();

        // Сначала обрабатываем группы вариаций
        categoryData.variantGroups.forEach((variants, mainName) => {
            const firstVariant = variants[0];
            const tag = categoryData.tags.get(firstVariant);
            if (tag) {
                const subgroup = tag.subgroup || '';
                if (!subgroups.has(subgroup)) {
                    subgroups.set(subgroup, []);
                }

                // Добавляем всю группу вариаций
                const variantGroup = {
                    type: 'variant',
                    mainName: mainName,
                    variants: variants.map(variantName => categoryData.tags.get(variantName)),
                    description: tag.description
                };
                subgroups.get(subgroup).push(variantGroup);
                processedMainNames.add(mainName);
            }
        });

        // Затем добавляем одиночные теги
        categoryData.tags.forEach(tag => {
            // Пропускаем если это вариант или уже обработан в группе
            if (tag.isVariant || processedMainNames.has(tag.mainName)) {
                return;
            }

            const subgroup = tag.subgroup || '';
            if (!subgroups.has(subgroup)) {
                subgroups.set(subgroup, []);
            }

            subgroups.get(subgroup).push({
                type: 'single',
                tag: tag
            });
        });

        return subgroups;
    }

    createTagsGroup(tags, categoryName, categoryData) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'tags-group';

        tags.forEach(item => {
            if (item.type === 'variant') {
                // Создаем группу вариаций с общей рамкой
                const variantGroup = this.createVariantGroup(item, categoryName, categoryData);
                groupDiv.appendChild(variantGroup);
            } else {
                // Одиночный тег
                const button = this.createTagButton(item.tag, categoryName, categoryData);
                groupDiv.appendChild(button);
            }
        });

        return groupDiv;
    }

    createVariantGroup(variantGroup, categoryName, categoryData) {
        const variantContainer = document.createElement('div');
        variantContainer.className = 'variant-group';

        const variantButtons = document.createElement('div');
        variantButtons.className = 'variant-buttons';

        variantGroup.variants.forEach(tag => {
            const button = this.createTagButton(tag, categoryName, categoryData);
            variantButtons.appendChild(button);
        });

        variantContainer.appendChild(variantButtons);

        if (variantGroup.description) {
            const description = document.createElement('div');
            description.className = 'variant-description';
            description.textContent = variantGroup.description;
            variantContainer.appendChild(description);
        }

        return variantContainer;
    }

    createTagButton(tag, categoryName, categoryData) {
        const button = document.createElement('button');
        button.className = 'tag-button';
        button.textContent = tag.name;

        if (tag.description) {
            button.title = tag.description;
        }

        button.addEventListener('click', () => {
            this.handleTagClick(categoryName, tag.name, categoryData.type, tag.mainName);
        });

        return button;
    }

    handleTagClick(categoryName, tagName, categoryType, mainName = null) {
        const categoryData = this.categories.get(categoryName);
        const actualTagName = mainName || tagName;

        if (categoryType === 'single') {
            this.handleSingleCategory(categoryData, actualTagName);
        } else if (categoryType === 'ordered') {
            this.handleOrderedCategory(categoryData, actualTagName);
        } else {
            this.handleStandardCategory(categoryData, actualTagName);
        }

        this.updateDisplay();
    }

    handleSingleCategory(categoryData, tagName) {
        if (categoryData.selectedTags.has(tagName)) {
            categoryData.selectedTags.delete(tagName);
            this.selectedTags.delete(tagName);
        } else {
            if (categoryData.selectedTags.size > 0) {
                const previousTag = Array.from(categoryData.selectedTags)[0];
                categoryData.selectedTags.delete(previousTag);
                this.selectedTags.delete(previousTag);
            }
            categoryData.selectedTags.add(tagName);
            this.selectedTags.set(tagName, categoryData.name);
        }
    }

    handleOrderedCategory(categoryData, tagName) {
        if (categoryData.selectedTags.has(tagName)) {
            // Удаляем тег из orderedTags и selectedTags
            const index = categoryData.orderedTags.indexOf(tagName);
            categoryData.orderedTags.splice(index, 1);
            categoryData.selectedTags.delete(tagName);
            this.selectedTags.delete(tagName);
        } else {
            // Добавляем тег в orderedTags и selectedTags
            categoryData.orderedTags.push(tagName);
            categoryData.selectedTags.add(tagName);
            this.selectedTags.set(tagName, categoryData.name);
        }
    }

    handleStandardCategory(categoryData, tagName) {
        // Для стандартной категории с вариациями - можно выбрать только один вариант из группы
        const variantGroup = categoryData.variantGroups.get(tagName);

        if (variantGroup) {
            // Если это группа вариаций, снимаем выбор с других вариантов этой группы
            variantGroup.forEach(variant => {
                if (categoryData.selectedTags.has(variant) && variant !== tagName) {
                    categoryData.selectedTags.delete(variant);
                    this.selectedTags.delete(variant);
                }
            });
        }

        if (categoryData.selectedTags.has(tagName)) {
            categoryData.selectedTags.delete(tagName);
            this.selectedTags.delete(tagName);
        } else {
            categoryData.selectedTags.add(tagName);
            this.selectedTags.set(tagName, categoryData.name);
        }
    }

    // Функция 1: Создание результирующей строки
    createResultString() {
        const tags = [];

        // Проходим по категориям в порядке из JSON
        this.tagsData.categories.forEach(categoryConfig => {
            const categoryName = categoryConfig.name;
            const categoryData = this.categories.get(categoryName);

            if (!categoryData) return;

            // Для каждой категории получаем теги в правильном порядке
            if (categoryData.type === 'ordered') {
                // Для ordered категории - берем порядок из orderedTags
                tags.push(...categoryData.orderedTags);
            } else if (categoryData.type === 'single') {
                // Для single категории - берем первый выбранный тег
                if (categoryData.selectedTags.size > 0) {
                    tags.push(Array.from(categoryData.selectedTags)[0]);
                }
            } else {
                // Для standard категории - берем теги в порядке из JSON
                const categoryTagsInOrder = [];
                categoryConfig.tags.forEach(tagConfig => {
                    const names = Array.isArray(tagConfig.name) ? tagConfig.name : [tagConfig.name];
                    const mainName = names[0];

                    // Ищем выбранный вариант из этой группы
                    let selectedVariant = null;
                    names.forEach(name => {
                        if (categoryData.selectedTags.has(name)) {
                            selectedVariant = name;
                        }
                    });

                    if (selectedVariant) {
                        categoryTagsInOrder.push(selectedVariant);
                    }
                });
                tags.push(...categoryTagsInOrder);
            }
        });

        return tags.join(this.tagsData.separator);
    }

    // Функция 2: Создание альтернативной строки
    createAlternativeString() {
        const alternativeTags = [];

        // Проходим по категориям в порядке из JSON
        this.tagsData.categories.forEach(categoryConfig => {
            const categoryName = categoryConfig.name;
            const categoryData = this.categories.get(categoryName);

            if (!categoryData) return;

            // Для каждой категории получаем альтернативные теги в правильном порядке
            if (categoryData.type === 'ordered') {
                // Для ordered категории - берем порядок из orderedTags
                categoryData.orderedTags.forEach(tagName => {
                    const tag = categoryData.tags.get(tagName);
                    if (tag && tag.alternative) {
                        alternativeTags.push(tag.alternative);
                    }
                });
            } else if (categoryData.type === 'single') {
                // Для single категории - берем первый выбранный тег
                if (categoryData.selectedTags.size > 0) {
                    const tagName = Array.from(categoryData.selectedTags)[0];
                    const tag = categoryData.tags.get(tagName);
                    if (tag && tag.alternative) {
                        alternativeTags.push(tag.alternative);
                    }
                }
            } else {
                // Для standard категории - берем теги в порядке из JSON
                categoryConfig.tags.forEach(tagConfig => {
                    const names = Array.isArray(tagConfig.name) ? tagConfig.name : [tagConfig.name];

                    // Ищем выбранный вариант из этой группы
                    let selectedVariant = null;
                    names.forEach(name => {
                        if (categoryData.selectedTags.has(name)) {
                            selectedVariant = name;
                        }
                    });

                    if (selectedVariant && tagConfig.alternative) {
                        alternativeTags.push(tagConfig.alternative);
                    }
                });
            }
        });

        return alternativeTags.join(this.tagsData.alternativeSeparator);
    }

    // Функция 2a: Создание альтернативной строки без дубликатов
    createAlternativeStringWithoutDuplicates() {
        const alternativeTags = [];
        const seenAlternatives = new Set();

        // Проходим по категориям в порядке из JSON
        this.tagsData.categories.forEach(categoryConfig => {
            const categoryName = categoryConfig.name;
            const categoryData = this.categories.get(categoryName);

            if (!categoryData) return;

            // Для каждой категории получаем альтернативные теги в правильном порядке
            if (categoryData.type === 'ordered') {
                // Для ordered категории - берем порядок из orderedTags
                categoryData.orderedTags.forEach(tagName => {
                    const tag = categoryData.tags.get(tagName);
                    if (tag && tag.alternative) {
                        // Нормализуем строку для корректного сравнения
                        const normalizedAlternative = this.normalizeString(tag.alternative);
                        if (!seenAlternatives.has(normalizedAlternative)) {
                            alternativeTags.push(tag.alternative);
                            seenAlternatives.add(normalizedAlternative);
                        }
                    }
                });
            } else if (categoryData.type === 'single') {
                // Для single категории - берем первый выбранный тег
                if (categoryData.selectedTags.size > 0) {
                    const tagName = Array.from(categoryData.selectedTags)[0];
                    const tag = categoryData.tags.get(tagName);
                    if (tag && tag.alternative) {
                        const normalizedAlternative = this.normalizeString(tag.alternative);
                        if (!seenAlternatives.has(normalizedAlternative)) {
                            alternativeTags.push(tag.alternative);
                            seenAlternatives.add(normalizedAlternative);
                        }
                    }
                }
            } else {
                // Для standard категории - берем теги в порядке из JSON
                categoryConfig.tags.forEach(tagConfig => {
                    const names = Array.isArray(tagConfig.name) ? tagConfig.name : [tagConfig.name];

                    // Ищем выбранный вариант из этой группы
                    let selectedVariant = null;
                    names.forEach(name => {
                        if (categoryData.selectedTags.has(name)) {
                            selectedVariant = name;
                        }
                    });

                    if (selectedVariant && tagConfig.alternative) {
                        const normalizedAlternative = this.normalizeString(tagConfig.alternative);
                        if (!seenAlternatives.has(normalizedAlternative)) {
                            alternativeTags.push(tagConfig.alternative);
                            seenAlternatives.add(normalizedAlternative);
                        }
                    }
                });
            }
        });

        return alternativeTags.join(this.tagsData.alternativeSeparator);
    }

    // Вспомогательная функция для нормализации строк
    normalizeString(str) {
        return str
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ') // Заменяем множественные пробелы на один
            .replace(/[^\w\s\[\]\/:\.\-]/g, ''); // Удаляем специальные символы, кроме тех что используются в URL и HTML
    }

    // Функция 3: Парсинг входной строки
    parseInputString(inputString) {
        this.clearAllSelections();

        const tags = inputString.split(this.tagsData.separator)
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);

        let lastCategory = null;

        tags.forEach(tag => {
            let categoryFound = null;
            let tagFound = null;
            let mainName = null;

            // Сначала ищем в той же категории, что и предыдущий тег
            if (lastCategory) {
                const category = this.categories.get(lastCategory);
                if (category) {
                    // Проверяем есть ли такой тег
                    if (category.tags.has(tag)) {
                        categoryFound = lastCategory;
                        tagFound = tag;
                        mainName = category.tags.get(tag).mainName;
                    }
                }
            }

            // Если не нашли, ищем во всех категориях
            if (!categoryFound) {
                for (const [categoryName, category] of this.categories) {
                    if (category.tags.has(tag)) {
                        categoryFound = categoryName;
                        tagFound = tag;
                        mainName = category.tags.get(tag).mainName;
                        break;
                    }
                }
            }

            if (categoryFound && tagFound) {
                const category = this.categories.get(categoryFound);
                const actualTagName = mainName || tagFound;

                if (category.type === 'single') {
                    // Для single категории очищаем предыдущий выбор
                    category.selectedTags.clear();
                    category.selectedTags.add(actualTagName);
                    this.selectedTags.set(actualTagName, categoryFound);
                } else if (category.type === 'ordered') {
                    // Для ordered категории добавляем тег в orderedTags
                    if (!category.orderedTags.includes(actualTagName)) {
                        category.orderedTags.push(actualTagName);
                        category.selectedTags.add(actualTagName);
                        this.selectedTags.set(actualTagName, categoryFound);
                    }
                } else {
                    // Для standard категории
                    category.selectedTags.add(actualTagName);
                    this.selectedTags.set(actualTagName, categoryFound);
                }

                lastCategory = categoryFound;
            }
        });
    }

    clearAllSelections() {
        this.selectedTags.clear();
        this.categories.forEach(category => {
            category.selectedTags.clear();
            category.orderedTags = [];
        });
    }

    updateDisplay() {
        this.updateInputField();
        this.updateTagsAppearance();
        this.updateAlternativeSection();
        this.updateLimitDisplay();
    }

    updateInputField() {
        const input = document.getElementById('tagsInput');
        const resultString = this.createResultString();

        // Проверяем лимит
        const limitCheckbox = document.getElementById('limitCheckbox');
        const isLimitEnabled = limitCheckbox.checked;

        if (isLimitEnabled && resultString.length > this.tagsData.characterLimit) {
            // Откатываем изменения, если превышен лимит
            this.parseInputString(input.value);
            this.updateTagsAppearance();
        } else {
            input.value = resultString;
        }
    }

    updateTagsAppearance() {
        this.categories.forEach((categoryData, categoryName) => {
            // Находим категорию по тексту заголовка
            const categoryElements = document.querySelectorAll('.category');
            let categoryElement = null;

            for (const element of categoryElements) {
                const titleElement = element.querySelector('.category-title');
                if (titleElement && titleElement.textContent === categoryName) {
                    categoryElement = element;
                    break;
                }
            }

            if (!categoryElement) return;

            const buttons = categoryElement.querySelectorAll('.tag-button');

            buttons.forEach(button => {
                const tagName = button.textContent;
                const tag = categoryData.tags.get(tagName);
                if (!tag) return;

                const mainName = tag.mainName || tagName;
                const isSelected = categoryData.selectedTags.has(mainName);

                button.classList.toggle('selected', isSelected);

                if (categoryData.type === 'ordered' && isSelected) {
                    const orderIndex = categoryData.orderedTags.indexOf(mainName);
                    if (orderIndex !== -1) {
                        button.classList.add('ordered');
                        button.setAttribute('data-order', orderIndex + 1);
                    } else {
                        button.classList.remove('ordered');
                        button.removeAttribute('data-order');
                    }
                } else {
                    button.classList.remove('ordered');
                    button.removeAttribute('data-order');
                }
            });
        });
    }

    updateAlternativeSection() {
        const alternativeSection = document.getElementById('alternativeSection');
        const alternativeOutput = document.getElementById('alternativeOutput');
        const removeDuplicatesCheckbox = document.getElementById('removeDuplicatesCheckbox');

        let alternativeString;

        if (removeDuplicatesCheckbox.checked) {
            alternativeString = this.createAlternativeStringWithoutDuplicates();
        } else {
            alternativeString = this.createAlternativeString();
        }

        if (alternativeString) {
            alternativeSection.classList.remove('hidden');
            alternativeOutput.value = alternativeString;
        } else {
            alternativeSection.classList.add('hidden');
        }
    }

    updateLimitDisplay() {
        const limitDisplay = document.getElementById('limitDisplay');
        const currentLength = this.createResultString().length;
        const limit = this.tagsData.characterLimit;

        limitDisplay.textContent = `${currentLength}/${limit}`;

        const limitCheckbox = document.getElementById('limitCheckbox');
        if (limitCheckbox.checked && currentLength > limit) {
            limitDisplay.classList.add('exceeded');
        } else {
            limitDisplay.classList.remove('exceeded');
        }
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    new TagsManager();
});