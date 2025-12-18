"use client";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { locales, type Locale } from "@/i18n/routing";
import { Languages } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	initializeLiveTranslationListener,
	notifyLiveTranslationError,
	notifyLiveTranslationInitialized,
	notifyLiveTranslationReady,
	notifyLiveTranslationStarted,
	notifyLiveTranslationStopped,
	setupLiveTranslationMock,
} from "./live-translation-message";

// Map locale codes to language names for the translation API
const localeToLanguageName: Record<Locale, string> = {
	"zh-CN": "Chinese",
	"en-US": "English",
	"zh-TW": "Traditional Chinese",
	"ja-JP": "Japanese",
	"ko-KR": "Korean",
	"pt-BR": "Portuguese",
	"ru-RU": "Russian",
	"id-ID": "Indonesian",
	"fr-FR": "French",
	"it-IT": "Italian",
	"pl-PL": "Polish",
	"vi-VN": "Vietnamese",
	"tr-TR": "Turkish",
	"th-TH": "Thai",
	"de-DE": "German",
	"es-ES": "Spanish",
	"hi-IN": "Hindi",
};

// Display names for the dropdown
const localeDisplayNames: Record<Locale, string> = {
	"zh-CN": "简体中文",
	"en-US": "English",
	"zh-TW": "繁體中文",
	"ja-JP": "日本語",
	"ko-KR": "한국어",
	"pt-BR": "Português",
	"ru-RU": "Русский",
	"id-ID": "Bahasa Indonesia",
	"fr-FR": "Français",
	"it-IT": "Italiano",
	"pl-PL": "Polski",
	"vi-VN": "Tiếng Việt",
	"tr-TR": "Türkçe",
	"th-TH": "ไทย",
	"de-DE": "Deutsch",
	"es-ES": "Español",
	"hi-IN": "हिन्दी",
};

const MAX_CACHE_SIZE = 5000;
const TRANSLATE_BATCH_SIZE = 50;

// DEBUG_ONLY
const SHOW_TRANSLATE_BUTTON = false;

// Simple in-memory cache for translations
const translationCache = new Map<string, string>();

function getCachedTranslation(cacheKey: string): string | null {
	return translationCache.get(cacheKey) || null;
}

function setCachedTranslation(cacheKey: string, translated: string): void {
	// If cache is at max size, remove the oldest entry (FIFO)
	if (translationCache.size >= MAX_CACHE_SIZE) {
		// Get the first key (oldest entry) and delete it
		const firstKey = translationCache.keys().next().value;
		if (firstKey) {
			translationCache.delete(firstKey);
		}
	}
	translationCache.set(cacheKey, translated);
}

interface TextNodeData {
	node: Node;
	originalText: string;
	isPlaceholder?: boolean;
	isValue?: boolean;
	inputElement?: HTMLInputElement | HTMLTextAreaElement;
}

/**
 * Check if an element should exclude its entire subtree (not just itself)
 */
function shouldExcludeSubtree(element: Element): boolean {
	// These elements should exclude their entire subtree
	return (
		element.tagName === "SCRIPT" ||
		element.tagName === "STYLE" ||
		element.tagName === "NOSCRIPT" ||
		element.tagName === "CODE" ||
		element.tagName === "PRE"
	);
}

/**
 * Check if a text node should be excluded based on its parent chain
 * This is more efficient than checking the full element exclusion logic
 */
function shouldExcludeTextNode(textNode: Text): boolean {
	const parent = textNode.parentElement;
	if (!parent) return false;

	// Check if parent is a subtree-excluded element
	if (shouldExcludeSubtree(parent)) {
		return true;
	}

	// Check if parent or any ancestor has exclusion attributes
	let current: Element | null = parent;
	while (current) {
		// Check for exclusion attributes
		if (
			current.hasAttribute("data-no-translate") ||
			current.getAttribute("data-translate") === "false"
		) {
			return true;
		}

		// Check if it's inside the LiveTranslation component
		if (current.closest("[data-live-translation]")) {
			return true;
		}

		// Check if it's a subtree-excluded element
		if (shouldExcludeSubtree(current)) {
			return true;
		}

		current = current.parentElement;
	}

	return false;
}

/**
 * Extract text nodes from DOM using TreeWalker API (browser native, well-tested)
 * This is more reliable than manual DOM traversal
 * Only extracts actual TEXT_NODE nodes to avoid breaking React's DOM structure
 */
function extractTextNodes(root: Node = document.body): TextNodeData[] {
	const textNodes: TextNodeData[] = [];

	// Use TreeWalker with proper filtering
	// FILTER_REJECT for elements that should exclude entire subtrees
	// FILTER_ACCEPT for everything else (we'll filter text nodes manually)
	const walker = document.createTreeWalker(
		root,
		NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
		{
			acceptNode: (node: Node) => {
				if (node.nodeType === Node.ELEMENT_NODE) {
					const element = node as Element;
					// Only reject elements that should exclude entire subtrees
					if (shouldExcludeSubtree(element)) {
						return NodeFilter.FILTER_REJECT;
					}
					// Accept all other elements - we'll check exclusion when processing text nodes
					return NodeFilter.FILTER_ACCEPT;
				}
				// For text nodes, accept them - we'll filter in the processing loop
				if (node.nodeType === Node.TEXT_NODE) {
					return NodeFilter.FILTER_ACCEPT;
				}
				return NodeFilter.FILTER_ACCEPT;
			},
		},
	);

	let node: Node | null = null;

	while (true) {
		node = walker.nextNode();
		if (!node) break;

		if (node.nodeType === Node.TEXT_NODE) {
			const textNode = node as Text;

			// Check if this text node should be excluded
			if (shouldExcludeTextNode(textNode)) {
				continue;
			}

			// Extract text and check if it's meaningful
			// Use textContent directly to get the raw text
			const rawText = textNode.textContent || "";

			// Only process if there's actual content (even whitespace-only nodes might be important for spacing)
			// But we'll trim for the translation key
			if (rawText.length > 0) {
				const text = rawText.trim();
				const nonWhitespace = text.replace(/\s+/g, "");

				// Include any text node with non-whitespace content after trimming
				// This captures all visible text including single characters, words, etc.
				if (nonWhitespace.length > 0) {
					textNodes.push({
						node: textNode,
						originalText: text, // Store trimmed version for translation
					});
				}
			}
		} else if (node.nodeType === Node.ELEMENT_NODE) {
			const element = node as Element;

			// Handle input/textarea elements
			if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
				const input = element as HTMLInputElement | HTMLTextAreaElement;

				// Handle placeholders
				if (input.placeholder && input.placeholder.trim().length > 0) {
					textNodes.push({
						node: element,
						originalText: input.placeholder,
						isPlaceholder: true,
						inputElement: input,
					});
				}

				// Handle values for read-only or disabled inputs (display-only mode)
				// Also handle inputs with data-translate-value attribute
				if (
					input.value &&
					input.value.trim().length > 0 &&
					(input.readOnly ||
						input.disabled ||
						input.hasAttribute("data-translate-value"))
				) {
					textNodes.push({
						node: element,
						originalText: input.value,
						isValue: true,
						inputElement: input,
					});
				}
			}
		}
	}

	return textNodes;
}

interface LiveTranslationProps {
	translationToken: string;
}

export function LiveTranslation({ translationToken }: LiveTranslationProps) {
	const [selectedLocale, setSelectedLocale] = useState<Locale | null>(null);
	const [isTranslating, setIsTranslating] = useState(false);
	const originalTextsRef = useRef<Map<Node, string>>(new Map());
	const originalPlaceholdersRef = useRef<Map<Element, string>>(new Map());
	const originalValuesRef = useRef<Map<Element, string>>(new Map());
	const translationMapRef = useRef<Map<string, string>>(new Map());
	const isTranslatedRef = useRef(false);
	const mutationObserverRef = useRef<MutationObserver | null>(null);
	const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const isTranslatingNewContentRef = useRef(false);
	const pendingRetranslateRef = useRef(false);

	// Restore original text when component unmounts or locale changes
	const restoreOriginalTexts = useCallback(() => {
		// Stop observing DOM changes
		if (mutationObserverRef.current) {
			mutationObserverRef.current.disconnect();
			mutationObserverRef.current = null;
		}

		// Clear scroll timeout
		if (scrollTimeoutRef.current) {
			clearTimeout(scrollTimeoutRef.current);
			scrollTimeoutRef.current = null;
		}

		// Restore text nodes
		for (const [node, originalText] of originalTextsRef.current.entries()) {
			if (node.nodeType === Node.TEXT_NODE) {
				const textNode = node as Text;
				if (textNode.textContent !== originalText) {
					textNode.textContent = originalText;
				}
			}
		}

		// Restore input/textarea placeholders
		for (const [element, originalPlaceholder] of originalPlaceholdersRef.current.entries()) {
			if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
				const input = element as HTMLInputElement | HTMLTextAreaElement;
				input.placeholder = originalPlaceholder;
				input.removeAttribute("data-original-placeholder");
			}
		}

		// Restore input/textarea values
		for (const [element, originalValue] of originalValuesRef.current.entries()) {
			if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
				const input = element as HTMLInputElement | HTMLTextAreaElement;
				input.value = originalValue;
				input.removeAttribute("data-original-value");
			}
		}

		const wasTranslated = isTranslatedRef.current;
		originalTextsRef.current.clear();
		originalPlaceholdersRef.current.clear();
		originalValuesRef.current.clear();
		translationMapRef.current.clear();
		isTranslatedRef.current = false;

		// Send acknowledgment to parent if translation was active
		if (wasTranslated) {
			notifyLiveTranslationStopped();
		}
	}, []);

	// Translate the page
	const translatePage = useCallback(
		async (targetLocale: Locale) => {
			if (isTranslatedRef.current && selectedLocale === targetLocale) {
				// Send acknowledgment to parent that translation is already active
				notifyLiveTranslationStarted(targetLocale);
				return; // Already translated to this locale
			}

			setIsTranslating(true);

			try {
				// If already translated, restore first
				if (isTranslatedRef.current) {
					restoreOriginalTexts();
				}

				// 1. Get all text nodes
				const textNodes = extractTextNodes();
				if (textNodes.length === 0) {
					setSelectedLocale(targetLocale);
					isTranslatedRef.current = true;
					notifyLiveTranslationStarted(targetLocale);
					setIsTranslating(false);
					return;
				}

				// 2. Store original text for text nodes
				for (const { node, originalText, isPlaceholder, isValue, inputElement } of textNodes) {
					if (isPlaceholder && inputElement) {
						originalPlaceholdersRef.current.set(inputElement, originalText);
					} else if (isValue && inputElement) {
						originalValuesRef.current.set(inputElement, originalText);
					} else {
						originalTextsRef.current.set(node, originalText);
					}
				}

				// 3. Translate new text nodes
				const targetLang = localeToLanguageName[targetLocale];
				const uniqueTexts = Array.from(
					new Set(textNodes.map(({ originalText }) => originalText)),
				);
				const textsToTranslate = uniqueTexts;
				const cachedTranslations = new Map<string, string>();
				const uncachedTexts: string[] = [];
				for (const text of textsToTranslate) {
					const cacheKey = `${targetLang}-${text}`;
					const cached = getCachedTranslation(cacheKey);
					if (cached) {
						cachedTranslations.set(text, cached);
					} else {
						uncachedTexts.push(text);
					}
				}
				const translations: string[] = [];
				if (uncachedTexts.length > 0) {
					for (let i = 0; i < uncachedTexts.length; i += TRANSLATE_BATCH_SIZE) {
						const batch = uncachedTexts.slice(i, i + TRANSLATE_BATCH_SIZE);
						const batchTranslations = await translateBatch(
							batch,
							targetLocale,
							translationToken,
						);
						translations.push(...batchTranslations);
						for (let index = 0; index < batch.length; index++) {
							const original = batch[index];
							const translated = batchTranslations[index] || original;
							const cacheKey = `${targetLang}-${original}`;
							setCachedTranslation(cacheKey, translated);
						}
					}
				}
				const allTranslations: string[] = [];
				for (const text of textsToTranslate) {
					const cached = cachedTranslations.get(text);
					if (cached) {
						allTranslations.push(cached);
					} else {
						const uncachedIndex = uncachedTexts.indexOf(text);
						allTranslations.push(translations[uncachedIndex] || text);
					}
				}
				// Add to translation map
				const translationMap = new Map<string, string>();
				for (let index = 0; index < textsToTranslate.length; index++) {
					const original = textsToTranslate[index];
					const translated = allTranslations[index] || original;
					translationMap.set(original, translated);
					translationMapRef.current.set(original, translated);
				}

				// 4. Apply translations
				for (const {
					node,
					originalText,
					isPlaceholder,
					isValue,
					inputElement,
				} of textNodes) {
					const translated = translationMap.get(originalText) || originalText;
					if (translated && translated !== originalText) {
						if (isPlaceholder && inputElement) {
							if (!inputElement.hasAttribute("data-original-placeholder")) {
								inputElement.setAttribute(
									"data-original-placeholder",
									inputElement.placeholder,
								);
							}
							inputElement.placeholder = translated;
						} else if (isValue && inputElement) {
							if (!inputElement.hasAttribute("data-original-value")) {
								inputElement.setAttribute(
									"data-original-value",
									inputElement.value,
								);
							}
							inputElement.value = translated;
						} else if (node.nodeType === Node.TEXT_NODE) {
							const textNode = node as Text;
							textNode.textContent = translated;
						}
					}
				}

				setSelectedLocale(targetLocale);
				isTranslatedRef.current = true;
				// Send acknowledgment to parent
				notifyLiveTranslationStarted(targetLocale);
			} catch (error) {
				console.error("Failed to translate page:", error);
				restoreOriginalTexts();

				// Send error acknowledgment to parent
				notifyLiveTranslationError(
					error instanceof Error ? error : new Error("Unknown error"),
				);
			} finally {
				setIsTranslating(false);
			}
		},
		[selectedLocale, restoreOriginalTexts, translationToken],
	);

	/**
	 * Translate only new content that hasn't been translated yet
	 * This is used for dynamic translation when new content appears
	 */
	const translateNewContent = useCallback(
		async (targetLocale: Locale) => {
			// Prevent multiple simultaneous translations
			if (isTranslatingNewContentRef.current || isTranslating) {
				pendingRetranslateRef.current = true;
				return;
			}
			isTranslatingNewContentRef.current = true;
			pendingRetranslateRef.current = false;

			try {
				// 1. Get new text nodes
				const allTextNodes = extractTextNodes();
				const newTextNodes = allTextNodes.filter(({ node, originalText, isPlaceholder, isValue, inputElement }) => {
					if (isPlaceholder && inputElement) {
						return !originalPlaceholdersRef.current.has(inputElement);
					} else if (isValue && inputElement) {
						return !originalValuesRef.current.has(inputElement);
					} else {
						return !originalTextsRef.current.has(node);
					}
				});
				if (newTextNodes.length === 0) {
					isTranslatingNewContentRef.current = false;
					return;
				}

				// 2. Store original text for new text nodes
				for (const { node, originalText, isPlaceholder, isValue, inputElement } of newTextNodes) {
					if (isPlaceholder && inputElement) {
						if (!originalPlaceholdersRef.current.has(inputElement)) {
							originalPlaceholdersRef.current.set(inputElement, originalText);
						}
					} else if (isValue && inputElement) {
						if (!originalValuesRef.current.has(inputElement)) {
							originalValuesRef.current.set(inputElement, originalText);
						}
					} else if (node.nodeType === Node.TEXT_NODE) {
						if (!originalTextsRef.current.has(node)) {
							originalTextsRef.current.set(node, originalText);
						}
					}
				}

				// 3. Translate new text nodes
				const targetLang = localeToLanguageName[targetLocale];
				const uniqueTexts = Array.from(
					new Set(newTextNodes.map((node) => node.originalText)),
				);
				const textsToTranslate = uniqueTexts;
				const cachedTranslations = new Map<string, string>();
				const uncachedTexts: string[] = [];
				for (const text of textsToTranslate) {
					const cacheKey = `${targetLang}-${text}`;
					const cached = getCachedTranslation(cacheKey);
					if (cached) {
						cachedTranslations.set(text, cached);
					} else {
						uncachedTexts.push(text);
					}
				}
				const translations: string[] = [];
				if (uncachedTexts.length > 0) {
					for (let i = 0; i < uncachedTexts.length; i += TRANSLATE_BATCH_SIZE) {
						const batch = uncachedTexts.slice(i, i + TRANSLATE_BATCH_SIZE);
						const batchTranslations = await translateBatch(
							batch,
							targetLocale,
							translationToken,
						);
						translations.push(...batchTranslations);

						// Cache the new translations
						for (let index = 0; index < batch.length; index++) {
							const original = batch[index];
							const translated = batchTranslations[index] || original;
							const cacheKey = `${targetLang}-${original}`;
							setCachedTranslation(cacheKey, translated);
						}
					}
				}
				// Add to translation map
				for (const original of uniqueTexts) {
					const cached = cachedTranslations.get(original);
					if (cached) {
						translationMapRef.current.set(original, cached);
					} else {
						const index = uncachedTexts.indexOf(original);
						const translated = translations[index] || original;
						translationMapRef.current.set(original, translated);
					}
				}

				// 4. Apply translations
				for (const {
					node,
					originalText,
					isPlaceholder,
					isValue,
					inputElement,
				} of allTextNodes) {
					const translatedText = translationMapRef.current.get(originalText) || originalText;
					if (translatedText && translatedText !== originalText) {
						if (isPlaceholder && inputElement) {
							if (!inputElement.hasAttribute("data-original-placeholder")) {
								inputElement.setAttribute(
									"data-original-placeholder",
									inputElement.placeholder,
								);
							}
							inputElement.placeholder = translatedText;
						} else if (isValue && inputElement) {
							if (!inputElement.hasAttribute("data-original-value")) {
								inputElement.setAttribute(
									"data-original-value",
									inputElement.value,
								);
							}
							inputElement.value = translatedText;
						} else if (node.nodeType === Node.TEXT_NODE) {
							const textNode = node as Text;
							textNode.textContent = translatedText;
						}
					}
				}
			} catch (error) {
				console.error("Error translating new content:", error);
			} finally {
				isTranslatingNewContentRef.current = false;
				// Check if there are pending changes that need to be translated
				if (pendingRetranslateRef.current) {
					pendingRetranslateRef.current = false;
					// Schedule re-translation after a short delay
					setTimeout(() => {
						translateNewContent(targetLocale);
					}, 100);
				}
			}
		},
		[isTranslating, translationToken],
	);

	// Handle locale selection
	const handleLocaleSelect = useCallback(
		(locale: Locale) => {
			if (locale === selectedLocale && isTranslatedRef.current) {
				// If clicking the same locale, restore original
				restoreOriginalTexts();
				setSelectedLocale(null);
			} else {
				translatePage(locale);
			}
		},
		[selectedLocale, translatePage, restoreOriginalTexts],
	);

	// Set up dynamic translation observers when translation is active
	useEffect(() => {
		const isTranslated = isTranslatedRef.current;
		if (!isTranslated || !selectedLocale) {
			// Clean up observers when translation is not active
			if (mutationObserverRef.current) {
				mutationObserverRef.current.disconnect();
				mutationObserverRef.current = null;
			}
			if (scrollTimeoutRef.current) {
				clearTimeout(scrollTimeoutRef.current);
				scrollTimeoutRef.current = null;
			}
			return;
		}

		// Set up MutationObserver to watch for DOM changes
		const observer = new MutationObserver((mutations) => {
			// Check if any mutations added new text nodes or changed content
			let hasNewContent = false;
			for (const mutation of mutations) {
				if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
					// Check if any added nodes contain text content
					for (let i = 0; i < mutation.addedNodes.length; i++) {
						const node = mutation.addedNodes[i];
						if (node.nodeType === Node.TEXT_NODE) {
							const text = (node as Text).textContent?.trim();
							// Use length > 0 instead of > 2 to capture short texts (e.g., CJK characters)
							if (text && text.length > 0 && !originalTextsRef.current.has(node)) {
								hasNewContent = true;
								break;
							}
						} else if (node.nodeType === Node.ELEMENT_NODE) {
							// Check if element has text content or is an input/textarea
							const element = node as Element;
							if (
								element.textContent?.trim() ||
								element.tagName === "INPUT" ||
								element.tagName === "TEXTAREA"
							) {
								hasNewContent = true;
								break;
							}
						}
					}
					if (hasNewContent) break;
				} else if (mutation.type === "characterData") {
					// Text content changed - always treat as new content
					// Even if node is tracked, content changed so we need to re-evaluate
					const node = mutation.target;
					if (node.nodeType === Node.TEXT_NODE) {
						const text = (node as Text).textContent?.trim();
						// Use length > 0 instead of > 2 to capture short texts (e.g., CJK characters)
						if (text && text.length > 0) {
							hasNewContent = true;
							break;
						}
					}
				} else if (mutation.type === "attributes") {
					// Attribute changed - check if it's a value/placeholder change on input
					const target = mutation.target as Element;
					if (
						(target.tagName === "INPUT" || target.tagName === "TEXTAREA") &&
						(mutation.attributeName === "value" ||
							mutation.attributeName === "placeholder")
					) {
						hasNewContent = true;
						break;
					}
				}
			}

			if (hasNewContent) {
				// Debounce translation of new content
				if (scrollTimeoutRef.current) {
					clearTimeout(scrollTimeoutRef.current);
				}
				scrollTimeoutRef.current = setTimeout(() => {
					translateNewContent(selectedLocale);
				}, 300);
			}
		});

		// Start observing DOM changes
		observer.observe(document.body, {
			childList: true,
			subtree: true,
			characterData: true,
			attributes: true,
			attributeFilter: ["value", "placeholder"],
		});

		mutationObserverRef.current = observer;

		// Set up scroll listener to detect when new content is revealed
		const handleScroll = () => {
			if (scrollTimeoutRef.current) {
				clearTimeout(scrollTimeoutRef.current);
			}
			scrollTimeoutRef.current = setTimeout(() => {
				translateNewContent(selectedLocale);
			}, 500);
		};

		window.addEventListener("scroll", handleScroll, { passive: true });
		document.addEventListener("scroll", handleScroll, { passive: true });

		// Cleanup function
		return () => {
			observer.disconnect();
			window.removeEventListener("scroll", handleScroll);
			document.removeEventListener("scroll", handleScroll);
			if (scrollTimeoutRef.current) {
				clearTimeout(scrollTimeoutRef.current);
				scrollTimeoutRef.current = null;
			}
		};
	}, [selectedLocale, translateNewContent]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			restoreOriginalTexts();
		};
	}, [restoreOriginalTexts]);

	// Send ready message to parent when component mounts
	useEffect(() => {
		// Send supported languages to parent
		notifyLiveTranslationReady();
		// Send initialized message to indicate live translation has been cleared after page refresh
		notifyLiveTranslationInitialized();
	}, []);

	// Listen for postMessage from parent window
	useEffect(() => {
		const cleanup = initializeLiveTranslationListener({
			onStartTranslation: (targetLang: Locale) => {
				translatePage(targetLang);
			},
			onStopTranslation: () => {
				restoreOriginalTexts();
				setSelectedLocale(null);
			},
			onRestoreTranslation: () => {
				restoreOriginalTexts();
				setSelectedLocale(null);
				notifyLiveTranslationStopped();
			},
		});

		return cleanup;
	}, [translatePage, restoreOriginalTexts]);

	// Expose mock functions to window for testing
	useEffect(() => {
		setupLiveTranslationMock();
	}, []);

	if (!SHOW_TRANSLATE_BUTTON) {
		return null;
	}

	return (
		<div className="fixed bottom-6 right-6 z-50" data-live-translation>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="default"
						size="icon"
						className="rounded-full shadow-lg"
						disabled={isTranslating}
					>
						<Languages className="size-5" />
						{isTranslating && (
							<span className="absolute inset-0 flex items-center justify-center">
								<span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
							</span>
						)}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="end"
					className="max-h-[60vh] overflow-y-auto"
				>
					{locales.map((locale) => (
						<DropdownMenuItem
							data-no-translate
							key={locale}
							onClick={() => handleLocaleSelect(locale)}
							className={selectedLocale === locale ? "bg-accent" : ""}
						>
							{localeDisplayNames[locale]}
							{selectedLocale === locale && isTranslatedRef.current && (
								<span className="ml-auto text-xs">✓</span>
							)}
						</DropdownMenuItem>
					))}
					{isTranslatedRef.current && (
						<>
							<div className="my-1 h-px bg-border" />
							<DropdownMenuItem
								data-no-translate
								onClick={() => {
									restoreOriginalTexts();
									setSelectedLocale(null);
								}}
								className="text-muted-foreground"
							>
								Restore Original
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

/**
 * Chat completion response model
 */
interface Message {
	content: string;
	role: string;
	provider_specific_fields?: Record<string, unknown>;
}

interface Choice {
	finish_reason: string;
	index: number;
	message: Message;
	provider_specific_fields?: Record<string, unknown>;
}

interface Usage {
	completion_tokens: number;
	prompt_tokens: number;
	total_tokens: number;
}

interface ChatCompletionResponse {
	choices: Choice[];
	created: number;
	id: string;
	model: string;
	object: string;
	usage: Usage;
}

/**
 * Service function to call translation API
 */
async function serviceTextTranslate({
	content,
	targetLangName,
	token,
}: {
	content: string;
	targetLangName: string;
	token: string;
}): Promise<string> {
	const headers: HeadersInit = {
		"Content-Type": "application/json",
		Authorization: `Bearer ${token}`,
	};
	const response = await fetch(
		"https://cloudnative.tezign.com/litellm/api/v1/chat/completions",
		{
			method: "POST",
			headers,
			body: JSON.stringify({
				model: "qwen-mt-flash",
				messages: [
					{
						role: "user",
						content,
					},
				],
				translation_options: {
					source_lang: "auto",
					target_lang: targetLangName,
				},
			}),
		},
	);
	if (!response.ok) {
		throw new Error(`Translation API error: ${response.status}`);
	}
	const data = (await response.json()) as ChatCompletionResponse;
	let translatedText = content;
	if (data.choices?.[0]?.message?.content) {
		translatedText = data.choices[0].message.content;
	}
	return translatedText;
}

/**
 * Convert locale code to language name
 */
function convertLangCodeToName(locale: Locale): string {
	return localeToLanguageName[locale];
}

/**
 * Batch translate multiple texts using a single API call
 */
async function translateBatch(
	texts: string[],
	targetLocale: Locale,
	token: string,
): Promise<string[]> {
	const targetLangName = convertLangCodeToName(targetLocale);
	const debugPrint = false;

	if (texts.length === 0) {
		return [];
	}

	const separator = "<======>";

	try {
		// Join all texts with separator, adding separator before each text (including the first)
		const combinedText = texts
			.map((text) => `\n${separator}\n${text}`)
			.join("");

		if (debugPrint) console.log("batch input = ", combinedText);
		// Translate the combined text in a single API call
		const response = await serviceTextTranslate({
			content: combinedText,
			targetLangName,
			token,
		});
		if (debugPrint) console.log("batch output = ", response);

		// Handle response - extract the translated text
		let translatedText: string;
		if (typeof response === "string") {
			translatedText = response;
		} else if (response && typeof response === "object") {
			// If response is an object, try to extract translated text
			const responseObj = response as Record<string, unknown>;
			translatedText =
				(typeof responseObj.translatedText === "string"
					? responseObj.translatedText
					: null) ||
				(typeof responseObj.content === "string"
					? responseObj.content
					: null) ||
				(typeof responseObj.result === "string" ? responseObj.result : null) ||
				combinedText;
		} else {
			// If response is boolean or unexpected type, return original text
			translatedText = combinedText;
		}

		// Find the first occurrence of the separator pattern - this marks where the actual translation starts
		const separatorPattern = `${separator}\n`;
		const firstSeparatorIndex = translatedText.indexOf(separatorPattern);
		if (firstSeparatorIndex !== -1) {
			// Extract everything from the first separator (the separator itself will be part of the split)
			translatedText = translatedText.substring(firstSeparatorIndex);
		} else {
			// Fallback: try to find just the separator without newlines
			const simpleSeparatorIndex = translatedText.indexOf(separator);
			if (simpleSeparatorIndex !== -1) {
				// Find the newline before the separator
				const beforeSeparatorIndex = translatedText.lastIndexOf(
					"\n",
					simpleSeparatorIndex,
				);
				if (beforeSeparatorIndex !== -1) {
					translatedText = translatedText.substring(beforeSeparatorIndex + 1);
				} else {
					translatedText = translatedText.substring(simpleSeparatorIndex);
				}
			}
		}

		// Split the translated text back into array using the separator
		// Filter out empty strings that may result from leading separator
		const translations = translatedText
			.split(separatorPattern)
			.filter((text) => text.trim() !== "");

		// Ensure we return the same number of translations as input texts
		// If split results in fewer items, pad with original texts
		if (translations.length !== texts.length) {
			console.warn(
				`Translation count mismatch: expected ${texts.length}, got ${translations.length}. Padding with original texts.`,
			);
			while (translations.length < texts.length) {
				translations.push(texts[translations.length] || "failed");
			}
			// If we got more translations than expected, trim to match
			if (translations.length > texts.length) {
				translations.splice(texts.length);
			}
		}

		return translations;
	} catch (error) {
		console.error("Batch translation error:", error);
		// Fallback: return failed for all texts if batch fails
		return texts.map(() => "failed");
	}
}
