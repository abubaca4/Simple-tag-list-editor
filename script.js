class TagsManager {
    constructor() {
        this.tagsData = null;
        this.selectedTags = new Map();
        this.categories = new Map();
        this.variantTags = new Map();
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
            this.tagsData = this.getFallbackData();
            this.initializeCategories();
        }
    }

    setupInitialState() {
        const limitCheckbox = document.getElementById('limitCheckbox');
        limitCheckbox.checked = true;
    }

    parseInitialInput() {
        const input = document.getElementById('tagsInput');
        const initialValue = input.value.trim();

        if (initialValue) {
            this.parseInputString(initialValue);
        } else {
            this.clearAllSelections();
        }

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
                variantGroups: new Map(),
                selectedVariants: new Map() // Храним конкретный выбранный вариант для каждой группы
            };

            category.tags.forEach(tag => {
                const names = Array.isArray(tag.name) ? tag.name : [tag.name];
                const mainName = names[0];

                names.forEach(name => {
                    categoryData.tags.set(name, {
                        name: name,
                        mainName: mainName,
                        alternative: tag.alternative || '',
                        subgroup: tag.subgroup || '',
                        description: tag.description || '',
                        isVariant: name !== mainName
                    });

                    this.variantTags.set(name, mainName);
                });

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

        categoryData.variantGroups.forEach((variants, mainName) => {
            const firstVariant = variants[0];
            const tag = categoryData.tags.get(firstVariant);
            if (tag) {
                const subgroup = tag.subgroup || '';
                if (!subgroups.has(subgroup)) {
                    subgroups.set(subgroup, []);
                }

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

        categoryData.tags.forEach(tag => {
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
                const variantGroup = this.createVariantGroup(item, categoryName, categoryData);
                groupDiv.appendChild(variantGroup);
            } else {
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
            this.handleTagClick(categoryName, tag.name, categoryData.type);
        });

        return button;
    }

    handleTagClick(categoryName, clickedTagName, categoryType) {
        const categoryData = this.categories.get(categoryName);
        const tag = categoryData.tags.get(clickedTagName);
        const mainName = tag.mainName;

        if (categoryType === 'single') {
            this.handleSingleCategory(categoryData, mainName, clickedTagName);
        } else if (categoryType === 'ordered') {
            this.handleOrderedCategory(categoryData, mainName, clickedTagName);
        } else {
            this.handleStandardCategory(categoryData, clickedTagName, mainName);
        }

        this.updateDisplay();
    }

    handleSingleCategory(categoryData, mainName, clickedTagName) {
        if (categoryData.selectedTags.has(mainName)) {
            // Снимаем выбор
            categoryData.selectedTags.delete(mainName);
            this.selectedTags.delete(mainName);
            categoryData.selectedVariants.delete(mainName);
        } else {
            // Выбираем
            if (categoryData.selectedTags.size > 0) {
                const previousTag = Array.from(categoryData.selectedTags)[0];
                categoryData.selectedTags.delete(previousTag);
                this.selectedTags.delete(previousTag);
                categoryData.selectedVariants.delete(previousTag);
            }
            categoryData.selectedTags.add(mainName);
            this.selectedTags.set(mainName, categoryData.name);
            categoryData.selectedVariants.set(mainName, clickedTagName);
        }
    }

    handleOrderedCategory(categoryData, mainName, clickedTagName) {
        if (categoryData.selectedTags.has(mainName)) {
            const index = categoryData.orderedTags.indexOf(mainName);
            categoryData.orderedTags.splice(index, 1);
            categoryData.selectedTags.delete(mainName);
            this.selectedTags.delete(mainName);
            categoryData.selectedVariants.delete(mainName);
        } else {
            categoryData.orderedTags.push(mainName);
            categoryData.selectedTags.add(mainName);
            this.selectedTags.set(mainName, categoryData.name);
            categoryData.selectedVariants.set(mainName, clickedTagName);
        }
    }

    handleStandardCategory(categoryData, clickedTagName, mainName) {
        const variantGroup = categoryData.variantGroups.get(mainName);

        if (variantGroup) {
            // Это группа вариаций
            const isCurrentlySelected = categoryData.selectedTags.has(mainName);
            const currentVariant = categoryData.selectedVariants.get(mainName);

            if (isCurrentlySelected && currentVariant === clickedTagName) {
                // Снимаем выбор, если кликнули на уже выбранный вариант
                categoryData.selectedTags.delete(mainName);
                this.selectedTags.delete(mainName);
                categoryData.selectedVariants.delete(mainName);
            } else {
                // Выбираем новый вариант
                categoryData.selectedTags.add(mainName);
                this.selectedTags.set(mainName, categoryData.name);
                categoryData.selectedVariants.set(mainName, clickedTagName);
            }
        } else {
            // Обычный тег без вариаций
            if (categoryData.selectedTags.has(mainName)) {
                categoryData.selectedTags.delete(mainName);
                this.selectedTags.delete(mainName);
            } else {
                categoryData.selectedTags.add(mainName);
                this.selectedTags.set(mainName, categoryData.name);
                categoryData.selectedVariants.set(mainName, clickedTagName);
            }
        }
    }

    // Функция 1: Создание результирующей строки
    createResultString() {
        const tags = [];

        this.tagsData.categories.forEach(categoryConfig => {
            const categoryName = categoryConfig.name;
            const categoryData = this.categories.get(categoryName);

            if (!categoryData) return;

            if (categoryData.type === 'ordered') {
                // Для ordered категории используем выбранные варианты
                categoryData.orderedTags.forEach(mainName => {
                    const selectedVariant = categoryData.selectedVariants.get(mainName) || mainName;
                    tags.push(selectedVariant);
                });
            } else if (categoryData.type === 'single') {
                if (categoryData.selectedTags.size > 0) {
                    const mainName = Array.from(categoryData.selectedTags)[0];
                    const selectedVariant = categoryData.selectedVariants.get(mainName) || mainName;
                    tags.push(selectedVariant);
                }
            } else {
                const categoryTagsInOrder = [];
                categoryConfig.tags.forEach(tagConfig => {
                    const names = Array.isArray(tagConfig.name) ? tagConfig.name : [tagConfig.name];
                    const mainName = names[0];

                    if (categoryData.selectedTags.has(mainName)) {
                        const selectedVariant = categoryData.selectedVariants.get(mainName) || mainName;
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

        this.tagsData.categories.forEach(categoryConfig => {
            const categoryName = categoryConfig.name;
            const categoryData = this.categories.get(categoryName);

            if (!categoryData) return;

            if (categoryData.type === 'ordered') {
                categoryData.orderedTags.forEach(mainName => {
                    const tag = categoryData.tags.get(mainName);
                    if (tag && tag.alternative) {
                        alternativeTags.push(tag.alternative);
                    }
                });
            } else if (categoryData.type === 'single') {
                if (categoryData.selectedTags.size > 0) {
                    const mainName = Array.from(categoryData.selectedTags)[0];
                    const tag = categoryData.tags.get(mainName);
                    if (tag && tag.alternative) {
                        alternativeTags.push(tag.alternative);
                    }
                }
            } else {
                categoryConfig.tags.forEach(tagConfig => {
                    const names = Array.isArray(tagConfig.name) ? tagConfig.name : [tagConfig.name];
                    const mainName = names[0];

                    if (categoryData.selectedTags.has(mainName) && tagConfig.alternative) {
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

        this.tagsData.categories.forEach(categoryConfig => {
            const categoryName = categoryConfig.name;
            const categoryData = this.categories.get(categoryName);

            if (!categoryData) return;

            if (categoryData.type === 'ordered') {
                categoryData.orderedTags.forEach(mainName => {
                    const tag = categoryData.tags.get(mainName);
                    if (tag && tag.alternative) {
                        const normalizedAlternative = this.normalizeString(tag.alternative);
                        if (!seenAlternatives.has(normalizedAlternative)) {
                            alternativeTags.push(tag.alternative);
                            seenAlternatives.add(normalizedAlternative);
                        }
                    }
                });
            } else if (categoryData.type === 'single') {
                if (categoryData.selectedTags.size > 0) {
                    const mainName = Array.from(categoryData.selectedTags)[0];
                    const tag = categoryData.tags.get(mainName);
                    if (tag && tag.alternative) {
                        const normalizedAlternative = this.normalizeString(tag.alternative);
                        if (!seenAlternatives.has(normalizedAlternative)) {
                            alternativeTags.push(tag.alternative);
                            seenAlternatives.add(normalizedAlternative);
                        }
                    }
                }
            } else {
                categoryConfig.tags.forEach(tagConfig => {
                    const names = Array.isArray(tagConfig.name) ? tagConfig.name : [tagConfig.name];
                    const mainName = names[0];

                    if (categoryData.selectedTags.has(mainName) && tagConfig.alternative) {
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

    normalizeString(str) {
        return str
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s\[\]\/:\.\-]/g, '');
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

            if (lastCategory) {
                const category = this.categories.get(lastCategory);
                if (category && category.tags.has(tag)) {
                    categoryFound = lastCategory;
                    tagFound = tag;
                    mainName = category.tags.get(tag).mainName;
                }
            }

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

                if (category.type === 'single') {
                    category.selectedTags.clear();
                    category.selectedTags.add(mainName);
                    this.selectedTags.set(mainName, categoryFound);
                    category.selectedVariants.set(mainName, tagFound);
                } else if (category.type === 'ordered') {
                    if (!category.orderedTags.includes(mainName)) {
                        category.orderedTags.push(mainName);
                        category.selectedTags.add(mainName);
                        this.selectedTags.set(mainName, categoryFound);
                        category.selectedVariants.set(mainName, tagFound);
                    }
                } else {
                    category.selectedTags.add(mainName);
                    this.selectedTags.set(mainName, categoryFound);
                    category.selectedVariants.set(mainName, tagFound);
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
            category.selectedVariants.clear();
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

        const limitCheckbox = document.getElementById('limitCheckbox');
        const isLimitEnabled = limitCheckbox.checked;

        if (isLimitEnabled && resultString.length > this.tagsData.characterLimit) {
            this.parseInputString(input.value);
            this.updateTagsAppearance();
        } else {
            input.value = resultString;
        }
    }

    updateTagsAppearance() {
        this.categories.forEach((categoryData, categoryName) => {
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

                const mainName = tag.mainName;
                const isGroupSelected = categoryData.selectedTags.has(mainName);
                const selectedVariant = categoryData.selectedVariants.get(mainName);

                // Подсвечиваем кнопку только если она является выбранным вариантом в группе
                const isThisVariantSelected = isGroupSelected && selectedVariant === tagName;

                button.classList.toggle('selected', isThisVariantSelected);

                if (categoryData.type === 'ordered' && isThisVariantSelected) {
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

document.addEventListener('DOMContentLoaded', () => {
    new TagsManager();
});