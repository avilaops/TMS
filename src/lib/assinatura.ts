/**
 * Acompanha o traço no quadro de assinatura da baixa.
 *
 * O quadro em branco também vira PNG, então "soltou o dedo" não basta para
 * dizer que houve assinatura: só conta quando o ponteiro desceu no quadro e
 * riscou. Sem traço, a baixa segue sem assinatura.
 */
export function createStrokeTracker() {
  let drawing = false;
  let hasStroke = false;

  return {
    /** O ponteiro desceu no quadro. */
    start() {
      drawing = true;
    },
    /** O ponteiro andou. Devolve `true` quando é para riscar. */
    move() {
      if (!drawing) return false;
      hasStroke = true;
      return true;
    },
    /**
     * O ponteiro subiu ou saiu do quadro. Devolve `true` quando há assinatura
     * nova para guardar.
     */
    end() {
      const wasDrawing = drawing;
      drawing = false;
      return wasDrawing && hasStroke;
    },
    /** O quadro foi limpo. */
    clear() {
      drawing = false;
      hasStroke = false;
    },
  };
}
