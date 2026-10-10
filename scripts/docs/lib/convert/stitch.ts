/**
 * Stage 2: "stitching".
 *
 * After remark parses the pre-processed Markdown, raw HTML appears as flat `html`
 * nodes: an opening `<Tab …>` in one node, Markdown paragraphs as siblings, and the
 * matching `</Tab>` in a later node. This stage tokenizes those fragments and
 * rebuilds a proper tree (`vpElement` / `vpContainer` nodes whose children are the
 * Markdown nodes in between), the same structure Vue sees when VitePress renders
 * the page.
 */
import type { Nodes, PhrasingContent, Root, RootContent } from 'mdast';
import { tokenizeHtml, VOID_ELEMENTS } from '../html.ts';
import type { IssueCollector } from '../issues.ts';
import type { VpContainer, VpElement } from './ast.ts';
import { PLACEHOLDER_RE, type Placeholder } from './preprocess.ts';

export interface StitchContext {
	placeholders: Map<number, Placeholder>;
	lineMap: number[];
	issues: IssueCollector;
}

type Frame = VpElement | VpContainer;

function originalLine(node: Nodes, ctx: StitchContext): number {
	const line = node.position?.start.line;
	return line === undefined ? 0 : (ctx.lineMap[line - 1] ?? line);
}

function lineOffset(source: string, index: number): number {
	let count = 0;
	for (let i = 0; i < index && i < source.length; i++) if (source[i] === '\n') count++;
	return count;
}

export function stitch(root: Root, ctx: StitchContext): void {
	root.children = stitchList(root.children, 'flow', ctx) as Root['children'];
}

/** Recurses into a node's children, stitching flow or phrasing content as appropriate. */
function stitchNode(node: RootContent, ctx: StitchContext): void {
	switch (node.type) {
		case 'paragraph':
		case 'heading':
		case 'tableCell':
		case 'emphasis':
		case 'strong':
		case 'delete':
		case 'link':
		case 'linkReference':
			node.children = stitchList(node.children, 'phrasing', ctx) as typeof node.children;
			break;
		case 'blockquote':
		case 'listItem':
		case 'footnoteDefinition':
			node.children = stitchList(node.children, 'flow', ctx) as typeof node.children;
			break;
		case 'list':
		case 'table':
		case 'tableRow':
			for (const child of node.children) stitchNode(child, ctx);
			break;
		default:
			break;
	}
}

function stitchList(children: RootContent[], context: 'flow' | 'phrasing', ctx: StitchContext): RootContent[] {
	const out: RootContent[] = [];
	const stack: Frame[] = [];

	const append = (node: RootContent) => {
		const top = stack[stack.length - 1];
		if (top) top.children.push(node);
		else out.push(node);
	};

	const reportUnclosed = (frame: Frame) => {
		if (frame.type === 'vpContainer') {
			ctx.issues.warn('unclosed-container', `Container "::: ${frame.name}" is never closed; it was closed at the end of its parent block.`, {
				line: frame.line,
				source: frame.source,
			});
		} else {
			ctx.issues.warn('unclosed-element', `<${frame.name}> is never closed; it was closed at the end of its parent block.`, {
				line: frame.line,
				source: frame.source,
			});
		}
	};

	const closeElement = (name: string): boolean => {
		for (let k = stack.length - 1; k >= 0; k--) {
			const frame = stack[k]!;
			if (frame.type === 'vpContainer') return false;
			if (frame.name.toLowerCase() !== name.toLowerCase()) continue;
			while (stack.length - 1 > k) {
				const unclosed = stack.pop()!;
				reportUnclosed(unclosed);
				append(unclosed);
			}
			const element = stack.pop() as VpElement;
			element.closed = true;
			append(element);
			return true;
		}
		return false;
	};

	const processHtml = (source: string, line: number) => {
		for (const token of tokenizeHtml(source)) {
			const tokenLine = line + lineOffset(source, token.start);
			switch (token.type) {
				case 'open': {
					const element: VpElement = {
						type: 'vpElement',
						name: token.name,
						attributes: token.attributes,
						children: [],
						selfClosing: token.selfClosing,
						source: token.raw,
						line: tokenLine,
						context,
						closed: false,
					};
					if (token.selfClosing || VOID_ELEMENTS.has(token.name.toLowerCase())) {
						element.closed = true;
						append(element);
					} else {
						stack.push(element);
					}
					break;
				}
				case 'close': {
					if (VOID_ELEMENTS.has(token.name.toLowerCase())) break;
					if (!closeElement(token.name)) {
						ctx.issues.warn('unmatched-closing-tag', `Closing tag </${token.name}> has no matching opening tag; it was kept as literal text.`, {
							line: tokenLine,
							source: token.raw,
						});
						append({ type: 'vpText', value: token.raw });
					}
					break;
				}
				case 'text':
					append({ type: 'vpText', value: token.value });
					break;
				case 'comment':
					append({ type: 'vpComment', value: token.value, line: tokenLine });
					break;
			}
		}
	};

	for (const child of children) {
		if (child.type === 'html') {
			const match = PLACEHOLDER_RE.exec(child.value);
			const placeholder = match ? ctx.placeholders.get(Number(match[1])) : undefined;
			if (placeholder?.kind === 'container-open') {
				stack.push({
					type: 'vpContainer',
					name: placeholder.name,
					title: placeholder.title,
					children: [],
					line: placeholder.line,
					source: placeholder.source,
					closed: false,
				});
				continue;
			}
			if (placeholder?.kind === 'container-close') {
				let k = stack.length - 1;
				while (k >= 0 && stack[k]!.type !== 'vpContainer') k--;
				if (k < 0) {
					ctx.issues.warn('stray-container-close', 'Closing ":::" marker without an open container.', {
						line: placeholder.line,
						source: placeholder.source,
					});
					continue;
				}
				while (stack.length - 1 > k) {
					const unclosed = stack.pop()!;
					reportUnclosed(unclosed);
					append(unclosed);
				}
				const container = stack.pop()!;
				container.closed = true;
				append(container);
				continue;
			}
			if (placeholder?.kind === 'html') {
				processHtml(placeholder.source, placeholder.line);
				continue;
			}
			processHtml(child.value, originalLine(child, ctx));
			continue;
		}
		stitchNode(child, ctx);
		append(child);
	}

	while (stack.length > 0) {
		const frame = stack.pop()!;
		reportUnclosed(frame);
		append(frame);
	}
	return out;
}

/** Re-runs phrasing stitching on an arbitrary phrasing list (used for nested inline content). */
export function stitchPhrasing(children: PhrasingContent[], ctx: StitchContext): PhrasingContent[] {
	return stitchList(children, 'phrasing', ctx) as PhrasingContent[];
}
