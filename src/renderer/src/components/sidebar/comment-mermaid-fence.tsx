import React from 'react'
import CommentMermaidBlock from './CommentMermaidBlock'

// Why: react-markdown sets className="language-mermaid" on the <code> inside a
// fenced ```mermaid block. Detecting it lets us render a real diagram instead of
// the raw source, matching the editor's markdown preview.
export function isMermaidFence(className: string | undefined): boolean {
  return /\blanguage-mermaid\b/.test(className ?? '')
}

// Why: a streaming reply feeds this an unterminated ```mermaid fence. The body
// is not valid Mermaid yet, and mounting the diagram throws a "Diagram error"
// until the closing fence arrives. mermaid.parse reports that cutoff as
// end-of-input: token EOF, or terminal id 1 (the parser prints it as got '1').
// Any other failure is a finished diagram, so the diagram component still
// mounts and can show its own error.
function mermaidFailureIsUnterminated(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const hash: unknown = Reflect.get(error, 'hash')
  if (typeof hash !== 'object' || hash === null) {
    return false
  }
  const token: unknown = Reflect.get(hash, 'token')
  return token === 'EOF' || token === 1 || token === '1'
}

function mermaidParse(api: object): ((text: string) => Promise<unknown>) | undefined {
  const parse: unknown = Reflect.get(api, 'parse')
  if (typeof parse !== 'function') {
    return undefined
  }
  return (text: string) => Promise.resolve(Reflect.apply(parse, api, [text]))
}

async function mermaidDiagramIsReady(content: string): Promise<boolean> {
  const mod = await import('mermaid')
  const parse = mermaidParse(mod.default)
  if (!parse) {
    return true
  }
  try {
    await parse(content)
    return true
  } catch (error) {
    return !mermaidFailureIsUnterminated(error)
  }
}

function MermaidFenceBlock({
  content,
  className
}: {
  content: string
  className?: string
}): React.JSX.Element {
  // Pending matches a settled diagram's first paint: an empty shell, not a <pre>.
  // The comment markdown static markup test depends on that shape.
  const [phase, setPhase] = React.useState<'pending' | 'source' | 'diagram'>('pending')

  React.useEffect(() => {
    let cancelled = false
    setPhase('pending')
    void mermaidDiagramIsReady(content).then(
      (accepted) => {
        if (!cancelled) {
          setPhase(accepted ? 'diagram' : 'source')
        }
      },
      () => {
        // A failed Mermaid load should still show the diagram shell, which
        // already owns the error banner.
        if (!cancelled) {
          setPhase('diagram')
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [content])

  if (phase === 'source') {
    const sourceClassName = className ? `language-mermaid ${className}` : 'language-mermaid'
    return (
      <pre className={sourceClassName}>
        <code>{content}</code>
      </pre>
    )
  }

  if (phase === 'diagram') {
    return <CommentMermaidBlock content={content} className={className} />
  }

  return (
    <div className={className}>
      <div className="mermaid-block" />
    </div>
  )
}

export function renderMermaidFence(
  children: React.ReactNode,
  className?: string
): React.JSX.Element {
  return <MermaidFenceBlock content={String(children).trimEnd()} className={className} />
}

// Why: MermaidBlock renders a <div> via innerHTML, which is invalid inside a
// <pre>. The <pre> renderer receives the inner <code> element (not the rendered
// diagram), so detect the mermaid fence from that child's className and unwrap.
export function isMermaidPre(children: React.ReactNode): boolean {
  const child = React.Children.toArray(children)[0]
  if (!React.isValidElement(child)) {
    return false
  }
  const className = (child.props as { className?: string } | null)?.className
  return isMermaidFence(className)
}
