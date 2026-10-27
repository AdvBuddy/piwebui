import { Children, isValidElement, memo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Icon } from "./Icon";

/** Keeps half-streamed fenced blocks from flickering as plain text. */
function stabilize(text: string): string {
	const fences = (text.match(/^```/gm) ?? []).length;
	return fences % 2 === 1 ? `${text}\n\`\`\`` : text;
}

function CodeBlock({ children }: { children: ReactNode }) {
	const ref = useRef<HTMLPreElement>(null);
	const [copied, setCopied] = useState(false);

	const child = Children.toArray(children)[0];
	const className =
		isValidElement(child) && typeof child.props === "object" && child.props
			? String((child.props as { className?: string }).className ?? "")
			: "";
	const language = /language-([\w+#-]+)/.exec(className)?.[1] ?? "text";

	const copy = async () => {
		const text = ref.current?.textContent ?? "";
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1600);
		} catch {
			/* clipboard may be blocked on insecure origins */
		}
	};

	return (
		<div className="code-block">
			<div className="code-block__bar">
				<span>{language}</span>
				<button
					type="button"
					onClick={copy}
					className="tap flex items-center gap-1 rounded px-1.5 py-0.5 text-fg-dim hover:bg-panel-3 hover:text-fg"
					aria-label="复制代码"
				>
					<Icon name={copied ? "check" : "copy"} size={13} />
					<span className="text-[10px]">{copied ? "已复制" : "复制"}</span>
				</button>
			</div>
			<pre ref={ref}>{children}</pre>
		</div>
	);
}

interface MarkdownProps {
	content: string;
	/** Skip heavy plugins while the message is still streaming. */
	streaming?: boolean;
}

export const Markdown = memo(function Markdown({ content }: MarkdownProps) {
	return (
		<div className="md">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
				components={{
					pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
					a: ({ children, href }) => (
						<a href={href} target="_blank" rel="noreferrer noopener">
							{children}
						</a>
					),
					table: ({ children }) => (
						<div className="overflow-x-auto">
							<table>{children}</table>
						</div>
					),
				}}
			>
				{stabilize(content)}
			</ReactMarkdown>
		</div>
	);
});
