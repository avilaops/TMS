import { Fragment, type ReactNode } from "react";
import type { Block } from "@/content/blog";

/**
 * Renderiza os blocos de uma materia do blog.
 *
 * O unico marcador inline aceito e o negrito com dois asteriscos, que cobre o
 * que as materias precisam sem trazer um parser de markdown para o bundle.
 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((piece, index) => {
    if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4) {
      return <strong key={index}>{piece.slice(2, -2)}</strong>;
    }
    return <Fragment key={index}>{piece}</Fragment>;
  });
}

export function PostBody({ blocks }: { blocks: Block[] }) {
  return (
    <div className="post-body">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "h2":
            return <h2 key={index}>{block.text}</h2>;
          case "h3":
            return <h3 key={index}>{block.text}</h3>;
          case "p":
            return <p key={index}>{inline(block.text)}</p>;
          case "ul":
            return (
              <ul key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{inline(item)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{inline(item)}</li>
                ))}
              </ol>
            );
          case "note":
            return (
              <aside className="post-note" key={index}>
                <strong>{block.title}</strong>
                <p>{inline(block.text)}</p>
              </aside>
            );
          case "table":
            return (
              <div className="post-table-wrap" key={index}>
                <table className="post-table">
                  <thead>
                    <tr>
                      {block.head.map((cell) => (
                        <th key={cell}>{cell}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex}>{inline(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
