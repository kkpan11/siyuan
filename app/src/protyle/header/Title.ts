import {
    focusBlock,
    focusByOffset,
    focusByRange,
    focusByWbr,
    getEditorRange,
    getSelectionOffset,
} from "../util/selection";
import {fetchPost} from "../../util/fetch";
import {replaceFileName, validateName} from "../../editor/rename";
import {MenuItem} from "../../menus/Menu";
import {openFileAttr,} from "../../menus/commonMenuItem";
import {Constants} from "../../constants";
import {matchHotKey} from "../util/hotKey";
import {isMac, readText} from "../util/compatibility";
import * as dayjs from "dayjs";
import {openFileById} from "../../editor/util";
import {setTitle} from "../../dialog/processSystem";
import {getContenteditableElement, getNoContainerElement} from "../wysiwyg/getBlock";
import {commonHotkey} from "../wysiwyg/commonHotkey";
import {code160to32} from "../util/code160to32";
import {genEmptyElement} from "../../block/util";
import {transaction} from "../wysiwyg/transaction";
import {hideTooltip} from "../../dialog/tooltip";
import {commonClick} from "../wysiwyg/commonClick";
import {openTitleMenu} from "./openTitleMenu";
import {electronUndo} from "../undo";
import {enableLuteMarkdownSyntax, restoreLuteMarkdownSyntax} from "../util/paste";

export class Title {
    public element: HTMLElement;
    public editElement: HTMLElement;
    private timeout: number;

    constructor(protyle: IProtyle) {
        this.element = document.createElement("div");
        this.element.className = "protyle-title";
        if (window.siyuan.config.editor.displayBookmarkIcon) {
            this.element.classList.add("protyle-wysiwyg--attr");
        }
        /// #if !MOBILE
        // 标题内需要一个空格，避免首次加载出现`请输入文档名`干扰
        this.element.innerHTML = `<span aria-label="${isMac() ? window.siyuan.languages.gutterTip2 : window.siyuan.languages.gutterTip2.replace("⇧", "Shift+")}" data-position="west" class="protyle-title__icon ariaLabel"><svg><use xlink:href="#iconFile"></use></svg></span>
<div contenteditable="true" spellcheck="${window.siyuan.config.editor.spellcheck}" class="protyle-title__input" data-tip="${window.siyuan.languages._kernel[16]}"> </div><div class="protyle-attr"></div>`;
        this.editElement = this.element.querySelector(".protyle-title__input");
        this.editElement.addEventListener("paste", (event: ClipboardEvent) => {
            event.stopPropagation();
            event.preventDefault();
            // 不能使用 range.insertNode，否则无法撤销
            let text = event.clipboardData.getData("text/siyuan");
            if (text) {
                try {
                    JSON.parse(text);
                    text = event.clipboardData.getData("text/plain");
                } catch (e) {
                    // 不为数据库，保持 text 不变
                }
                text = protyle.lute.BlockDOM2Content(text);
            } else {
                text = event.clipboardData.getData("text/plain");
            }
            // 阻止右键复制菜单报错
            setTimeout(function () {
                document.execCommand("insertText", false, replaceFileName(text));
            }, 0);
            this.rename(protyle);
        });
        this.editElement.addEventListener("click", () => {
            protyle.toolbar?.element.classList.add("fn__none");
        });
        this.editElement.addEventListener("input", (event: InputEvent) => {
            if (event.isComposing) {
                return;
            }
            if (this.editElement.textContent === "") {
                this.editElement.querySelectorAll("br").forEach(item => {
                    item.remove();
                });
            }
            this.rename(protyle);
        });
        this.editElement.addEventListener("compositionend", () => {
            this.rename(protyle);
        });
        this.editElement.addEventListener("drop", (event: DragEvent) => {
            // https://ld246.com/article/1661911210429
            event.stopPropagation();
            event.preventDefault();
        });
        this.editElement.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.isComposing) {
                return;
            }

            if (commonHotkey(protyle, event)) {
                return true;
            }
            if (matchHotKey("⇧⌘V", event)) {
                navigator.clipboard.readText().then(textPlain => {
                    // 对 HTML 标签进行内部转义，避免被 Lute 解析以后变为小写 https://github.com/siyuan-note/siyuan/issues/10620
                    textPlain = textPlain.replace(/</g, ";;;lt;;;").replace(/>/g, ";;;gt;;;");
                    enableLuteMarkdownSyntax(protyle);
                    let content = protyle.lute.BlockDOM2EscapeMarkerContent(protyle.lute.Md2BlockDOM(textPlain));
                    restoreLuteMarkdownSyntax(protyle);
                    // 移除 ;;;lt;;; 和 ;;;gt;;; 转义及其包裹的内容
                    content = content.replace(/;;;lt;;;[^;]+;;;gt;;;/g, "");
                    document.execCommand("insertText", false, replaceFileName(content));
                    this.rename(protyle);
                });
                event.preventDefault();
                event.stopPropagation();
            }
            if (matchHotKey(window.siyuan.config.keymap.general.enterBack.custom, event)) {
                const ids = protyle.path.split("/");
                if (ids.length > 2) {
                    openFileById({
                        app: protyle.app,
                        id: ids[ids.length - 2],
                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL]
                    });
                }
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (electronUndo(event)) {
                return;
            }
            if (event.key === "ArrowDown") {
                const rects = getSelection().getRangeAt(0).getClientRects();
                // https://github.com/siyuan-note/siyuan/issues/11729
                if (rects.length === 0 // 标题为空时时
                    || this.editElement.getBoundingClientRect().bottom - rects[rects.length - 1].bottom < 25) {
                    const noContainerElement = getNoContainerElement(protyle.wysiwyg.element.firstElementChild);
                    // https://github.com/siyuan-note/siyuan/issues/4923
                    if (noContainerElement) {
                        focusBlock(noContainerElement, protyle.wysiwyg.element);
                    }
                    event.preventDefault();
                    event.stopPropagation();
                }
            } else if (event.key === "Enter") {
                const editElment = getContenteditableElement(protyle.wysiwyg.element.firstElementChild);
                if (editElment && editElment.textContent === "" && !protyle.wysiwyg.element.firstElementChild.classList.contains("av")) {
                    // 配合提示文本使用，避免提示文本挤压到第二个块中
                    focusBlock(protyle.wysiwyg.element.firstElementChild, protyle.wysiwyg.element);
                } else {
                    const newId = Lute.NewNodeID();
                    const newElement = genEmptyElement(false, true, newId);
                    protyle.wysiwyg.element.insertAdjacentElement("afterbegin", newElement);
                    focusByWbr(newElement, protyle.toolbar.range || getEditorRange(newElement));
                    transaction(protyle, [{
                        action: "insert",
                        data: newElement.outerHTML,
                        id: newId,
                        parentID: protyle.block.parentID
                    }], [{
                        action: "delete",
                        id: newId,
                    }]);
                }
                event.preventDefault();
                event.stopPropagation();
            } else if (matchHotKey(window.siyuan.config.keymap.editor.general.attr.custom, event)) {
                fetchPost("/api/block/getDocInfo", {
                    id: protyle.block.rootID
                }, (response) => {
                    openFileAttr(response.data.ial, "bookmark", protyle);
                });
                event.preventDefault();
                event.stopPropagation();
            } else if (matchHotKey("⌘A", event)) {
                getEditorRange(this.editElement).selectNodeContents(this.editElement);
                event.preventDefault();
                event.stopPropagation();
            }
        });
        const iconElement = this.element.querySelector(".protyle-title__icon");
        iconElement.addEventListener("click", () => {
            if (window.siyuan.shiftIsPressed) {
                fetchPost("/api/block/getDocInfo", {
                    id: protyle.block.rootID
                }, (response) => {
                    openFileAttr(response.data.ial, "bookmark", protyle);
                });
            } else {
                const iconRect = iconElement.getBoundingClientRect();
                openTitleMenu(protyle, {x: iconRect.left, y: iconRect.bottom});
            }
        });
        this.element.addEventListener("contextmenu", (event) => {
            if (event.shiftKey) {
                return;
            }
            if (getSelection().rangeCount === 0) {
                openTitleMenu(protyle, {x: event.clientX, y: event.clientY});
                return;
            }
            protyle.toolbar?.element.classList.add("fn__none");
            window.siyuan.menus.menu.remove();
            const range = getEditorRange(this.editElement);
            if (range.toString() !== "") {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "copy",
                    icon: "iconCopy",
                    accelerator: "⌘C",
                    label: window.siyuan.languages.copy,
                    click: () => {
                        focusByRange(getEditorRange(this.editElement));
                        document.execCommand("copy");
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "cut",
                    icon: "iconCut",
                    accelerator: "⌘X",
                    label: window.siyuan.languages.cut,
                    click: () => {
                        focusByRange(getEditorRange(this.editElement));
                        document.execCommand("cut");
                        setTimeout(() => {
                            this.rename(protyle);
                        }, Constants.TIMEOUT_INPUT);
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "delete",
                    icon: "iconTrashcan",
                    accelerator: "⌫",
                    label: window.siyuan.languages.delete,
                    click: () => {
                        const range = getEditorRange(this.editElement);
                        range.extractContents();
                        focusByRange(range);
                        setTimeout(() => {
                            this.rename(protyle);
                        }, Constants.TIMEOUT_INPUT);
                    }
                }).element);
            }
            window.siyuan.menus.menu.append(new MenuItem({
                id: "paste",
                label: window.siyuan.languages.paste,
                icon: "iconPaste",
                accelerator: "⌘V",
                click: async () => {
                    focusByRange(getEditorRange(this.editElement));
                    if (document.queryCommandSupported("paste")) {
                        document.execCommand("paste");
                    } else {
                        try {
                            const text = await readText();
                            document.execCommand("insertText", false, replaceFileName(text));
                            this.rename(protyle);
                        } catch (e) {
                            console.log(e);
                        }
                    }
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "pasteAsPlainText",
                label: window.siyuan.languages.pasteAsPlainText,
                accelerator: "⇧⌘V",
                click: async () => {
                    navigator.clipboard.readText().then(textPlain => {
                        textPlain = textPlain.replace(/</g, ";;;lt;;;").replace(/>/g, ";;;gt;;;");
                        enableLuteMarkdownSyntax(protyle);
                        let content = protyle.lute.BlockDOM2EscapeMarkerContent(protyle.lute.Md2BlockDOM(textPlain));
                        restoreLuteMarkdownSyntax(protyle);
                        // 移除 ;;;lt;;; 和 ;;;gt;;; 转义及其包裹的内容
                        content = content.replace(/;;;lt;;;[^;]+;;;gt;;;/g, "");
                        document.execCommand("insertText", false, replaceFileName(content));
                        this.rename(protyle);
                    });
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "selectAll",
                label: window.siyuan.languages.selectAll,
                icon: "iconSelect",
                accelerator: "⌘A",
                click: () => {
                    range.selectNodeContents(this.editElement);
                    focusByRange(range);
                }
            }).element);
            window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY});
        });
        /// #else
        this.element.innerHTML = '<div class="protyle-attr"></div>';
        /// #endif
        this.element.querySelector(".protyle-attr").addEventListener("click", (event: MouseEvent & {
            target: HTMLElement
        }) => {
            fetchPost("/api/block/getDocInfo", {
                id: protyle.block.rootID
            }, (response) => {
                commonClick(event, protyle, response.data.ial);
            });
        });
    }

    private rename(protyle: IProtyle) {
        clearTimeout(this.timeout);
        if (!validateName(this.editElement.textContent, this.editElement)) {
            // 字数过长会导致滚动
            const offset = getSelectionOffset(this.editElement);
            this.setTitle(this.editElement.textContent.substring(0, Constants.SIZE_TITLE));
            focusByOffset(this.editElement, offset.start, offset.end);
            return false;
        }
        hideTooltip();
        this.timeout = window.setTimeout(() => {
            const fileName = replaceFileName(this.editElement.textContent);
            fetchPost("/api/filetree/renameDoc", {
                notebook: protyle.notebookId,
                path: protyle.path,
                title: fileName,
            });
            if (fileName !== this.editElement.textContent) {
                const offset = getSelectionOffset(this.editElement);
                this.setTitle(fileName);
                focusByOffset(this.editElement, offset.start, offset.end);
            }
            setTitle(fileName);
        }, Constants.TIMEOUT_INPUT);
    }

    public setTitle(title: string) {
        /// #if MOBILE
        const inputElement = document.getElementById("toolbarName") as HTMLInputElement;
        if (code160to32(title) !== code160to32(inputElement.value)) {
            inputElement.value = title === window.siyuan.languages.untitled ? "" : title;
        }
        /// #else
        if (code160to32(title) !== code160to32(this.editElement.textContent)) {
            this.editElement.textContent = title === window.siyuan.languages.untitled ? "" : title;
        }
        /// #endif
    }

    public render(protyle: IProtyle, response: IWebSocketData) {
        if (this.element.getAttribute("data-render") === "true") {
            return false;
        }
        this.element.setAttribute("data-node-id", protyle.block.rootID);
        if (response.data.ial[Constants.CUSTOM_RIFF_DECKS]) {
            this.element.setAttribute(Constants.CUSTOM_RIFF_DECKS, response.data.ial[Constants.CUSTOM_RIFF_DECKS]);
        }
        protyle.background?.render(response.data.ial, protyle.block.rootID);
        protyle.wysiwyg.renderCustom(response.data.ial);
        this.element.setAttribute("data-render", "true");
        this.setTitle(response.data.ial.title);
        let nodeAttrHTML = "";
        if (response.data.ial.bookmark) {
            nodeAttrHTML += `<div class="protyle-attr--bookmark">${Lute.EscapeHTMLStr(response.data.ial.bookmark)}</div>`;
        }
        if (response.data.ial.name) {
            nodeAttrHTML += `<div class="protyle-attr--name"><svg><use xlink:href="#iconN"></use></svg>${Lute.EscapeHTMLStr(response.data.ial.name)}</div>`;
        }
        if (response.data.ial.alias) {
            nodeAttrHTML += `<div class="protyle-attr--alias"><svg><use xlink:href="#iconA"></use></svg>${Lute.EscapeHTMLStr(response.data.ial.alias)}</div>`;
        }
        if (response.data.ial.memo) {
            nodeAttrHTML += `<div class="protyle-attr--memo b3-tooltips b3-tooltips__sw" aria-label="${Lute.EscapeHTMLStr(response.data.ial.memo)}"><svg><use xlink:href="#iconM"></use></svg></div>`;
        }
        if (response.data.ial["custom-avs"]) {
            let avTitle = "";
            response.data.attrViews.forEach((item: { id: string, name: string }) => {
                avTitle += `<span data-av-id="${item.id}" data-popover-url="/api/av/getMirrorDatabaseBlocks" class="popover__block">${item.name}</span>&nbsp;`;
            });
            if (avTitle) {
                avTitle = avTitle.substring(0, avTitle.length - 6);
            }
            nodeAttrHTML += `<div class="protyle-attr--av"><svg><use xlink:href="#iconDatabase"></use></svg>${avTitle}</div>`;
        }
        this.element.querySelector(".protyle-attr").innerHTML = nodeAttrHTML;
        if (response.data.refCount !== 0) {
            this.element.querySelector(".protyle-attr").insertAdjacentHTML("beforeend", `<div class="protyle-attr--refcount popover__block">${response.data.refCount}</div>`);
        }
        // 存在设置新建文档名模板，不能使用 Untitled 进行判断，https://ld246.com/article/1649301009888
        if (this.editElement && new Date().getTime() - dayjs(response.data.id.split("-")[0]).toDate().getTime() < 2000) {
            const range = this.editElement.ownerDocument.createRange();
            range.selectNodeContents(this.editElement);
            focusByRange(range);
        }
    }
}
