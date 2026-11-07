// React Bits Split Text-inspired word splitting; native CSS rise adaptation.
// No GSAP runtime or client hydration needed. Single load reveal, never hidden.
export function SplitText({ text }: { text: string }) {
  return (
    <span className="split-text">
      {text.split(" ").map((word, index) => (
        <span
          className="split-word"
          key={`${word}-${index}`}
          style={{ animationDelay: `${index * 60}ms` }}
        >
          {word}
          {index < text.split(" ").length - 1 ? "\u00a0" : ""}
        </span>
      ))}
    </span>
  );
}
