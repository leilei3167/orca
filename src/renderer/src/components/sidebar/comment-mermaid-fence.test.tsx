// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./CommentMermaidBlock', () => ({
  default: ({ content }: { content: string }) => <div data-testid="mermaid-diagram">{content}</div>
}))

import { renderMermaidFence } from './comment-mermaid-fence'

// The issue's mid-stream fence: the closing quote and bracket never arrived.
const TRUNCATED_DIAGRAM = `flowchart TD
  A["起点"] --> B["上下文不够用<br/>它没有「这是第几轮」`

const CLOSED_DIAGRAM = `${TRUNCATED_DIAGRAM}"]`

const MID_SYNTAX_DIAGRAM = `flowchart TD
  A --> B
  this is not valid
  C --> D`

afterEach(() => {
  cleanup()
})

describe('renderMermaidFence', () => {
  it('keeps a cut-off mermaid fence as source instead of mounting the diagram', async () => {
    render(renderMermaidFence(TRUNCATED_DIAGRAM, 'diagram-wrap'))

    await waitFor(() => {
      expect(screen.queryByTestId('mermaid-diagram')).toBeNull()
      expect(screen.getByText(/上下文不够用/)).toBeTruthy()
    })
  })

  it('mounts the diagram once the same fence is closed', async () => {
    render(renderMermaidFence(CLOSED_DIAGRAM, 'diagram-wrap'))

    const diagram = await screen.findByTestId('mermaid-diagram', {}, { timeout: 1500 })
    expect(diagram.textContent).toContain('上下文不够用')
  })

  it('still mounts a finished diagram that Mermaid rejects for a real syntax error', async () => {
    render(renderMermaidFence(MID_SYNTAX_DIAGRAM, 'diagram-wrap'))

    const diagram = await screen.findByTestId('mermaid-diagram')
    expect(diagram.textContent).toContain('this is not valid')
  })
})
