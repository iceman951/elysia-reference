import type { Nodes, Paragraph, PhrasingContent, RootContent, Text } from 'mdast';
import type { MdxJsxAttribute, MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx';
import type { Node } from 'unist';
import type { HtmlAttribute } from '../html.ts';

/**
 * Intermediate node types used between "stitching" (rebuilding element trees
 * from raw HTML fragments) and component mapping. None of them survive until
 * serialization.
 */

/** An HTML element or Vue component found in the upstream Markdown. */
export interface VpElement extends Node {
	type: 'vpElement';
	name: string;
	attributes: HtmlAttribute[];
	children: RootContent[];
	selfClosing: boolean;
	/** Raw source of the opening tag. */
	source: string;
	/** 1-based line in the upstream file. */
	line: number;
	context: 'flow' | 'phrasing';
	/** Whether the element was explicitly closed (or is void / self-closing). */
	closed: boolean;
}

/** Literal text from inside a raw HTML fragment (not parsed as Markdown upstream either). */
export interface VpText extends Node {
	type: 'vpText';
	value: string;
}

/** An HTML comment; upstream does not render it. */
export interface VpComment extends Node {
	type: 'vpComment';
	value: string;
	line: number;
}

/** A VitePress `::: name title` container. */
export interface VpContainer extends Node {
	type: 'vpContainer';
	name: string;
	title: string;
	children: RootContent[];
	line: number;
	source: string;
	closed: boolean;
}

declare module 'mdast' {
	interface RootContentMap {
		vpElement: VpElement;
		vpText: VpText;
		vpComment: VpComment;
		vpContainer: VpContainer;
	}
	interface BlockContentMap {
		vpElement: VpElement;
		vpText: VpText;
		vpComment: VpComment;
		vpContainer: VpContainer;
	}
	interface PhrasingContentMap {
		vpElement: VpElement;
		vpText: VpText;
		vpComment: VpComment;
	}
}

const PHRASING_TYPES = new Set([
	'text',
	'emphasis',
	'strong',
	'delete',
	'inlineCode',
	'break',
	'link',
	'linkReference',
	'image',
	'imageReference',
	'html',
	'footnoteReference',
	'mdxJsxTextElement',
	'mdxTextExpression',
	'textDirective',
	'vpText',
	'vpComment',
]);

export function isPhrasing(node: RootContent): boolean {
	if (node.type === 'vpElement') return node.context === 'phrasing' || node.children.every(isPhrasing);
	return PHRASING_TYPES.has(node.type);
}

export function hasChildren(node: Nodes): node is Extract<Nodes, { children: unknown[] }> {
	return 'children' in node && Array.isArray(node.children);
}

export function text(value: string): Text {
	return { type: 'text', value };
}

export function paragraph(children: PhrasingContent[]): Paragraph {
	return { type: 'paragraph', children };
}

export function jsxAttribute(name: string, value: string | null): MdxJsxAttribute {
	return { type: 'mdxJsxAttribute', name, value };
}

export function jsxFlow(
	name: string,
	attributes: Record<string, string | null | undefined> = {},
	children: MdxJsxFlowElement['children'] = []
): MdxJsxFlowElement {
	return {
		type: 'mdxJsxFlowElement',
		name,
		attributes: Object.entries(attributes)
			.filter((entry): entry is [string, string | null] => entry[1] !== undefined)
			.map(([key, value]) => jsxAttribute(key, value)),
		children,
	};
}

export function jsxText(
	name: string,
	attributes: Record<string, string | null | undefined> = {},
	children: MdxJsxTextElement['children'] = []
): MdxJsxTextElement {
	return {
		type: 'mdxJsxTextElement',
		name,
		attributes: Object.entries(attributes)
			.filter((entry): entry is [string, string | null] => entry[1] !== undefined)
			.map(([key, value]) => jsxAttribute(key, value)),
		children,
	};
}

/** Plain-text content of a subtree (text, inline code and raw HTML text). */
export function toPlainText(node: Nodes | RootContent): string {
	if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'vpText') return node.value;
	if (node.type === 'code') return node.value;
	if (node.type === 'break') return ' ';
	if ('children' in node && Array.isArray(node.children)) {
		return (node.children as RootContent[]).map((child) => toPlainText(child)).join('');
	}
	return '';
}

/** Collapses HTML whitespace the way a browser renders inline text. */
export function collapseWhitespace(value: string): string {
	return value.replace(/\s+/g, ' ');
}
