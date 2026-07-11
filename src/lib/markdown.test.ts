import { describe, it, expect } from "vitest";
import { escapeHtml, markdownToSafeHtml } from "./markdown";

describe("escapeHtml", () => {
  it("escapa los 5 caracteres sensibles de HTML", () => {
    expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
  });

  it("neutraliza un tag <script>", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("no toca texto sin caracteres especiales", () => {
    expect(escapeHtml("Hola mundo 123")).toBe("Hola mundo 123");
  });

  it("tolera vacío", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("markdownToSafeHtml", () => {
  it("convierte un heading nivel 1", () => {
    expect(markdownToSafeHtml("# Título")).toBe("<h1>Título</h1>");
  });

  it("convierte headings nivel 2 y 3", () => {
    expect(markdownToSafeHtml("## Subtítulo")).toBe("<h2>Subtítulo</h2>");
    expect(markdownToSafeHtml("### Detalle")).toBe("<h3>Detalle</h3>");
  });

  it("no trata 7+ numerales como heading (cae a párrafo)", () => {
    expect(markdownToSafeHtml("####### no es heading")).toBe("<p>####### no es heading</p>");
  });

  it("requiere espacio después de los numerales", () => {
    expect(markdownToSafeHtml("#SinEspacio")).toBe("<p>#SinEspacio</p>");
  });

  it("convierte **negrita**", () => {
    expect(markdownToSafeHtml("Esto es **importante** de verdad.")).toBe(
      "<p>Esto es <strong>importante</strong> de verdad.</p>"
    );
  });

  it("convierte *cursiva* y _cursiva_", () => {
    expect(markdownToSafeHtml("Una *idea* y otra _idea_.")).toBe("<p>Una <em>idea</em> y otra <em>idea</em>.</p>");
  });

  it("convierte una lista con viñetas (-, *, +)", () => {
    expect(markdownToSafeHtml("- Uno\n- Dos\n- Tres")).toBe("<ul><li>Uno</li><li>Dos</li><li>Tres</li></ul>");
    expect(markdownToSafeHtml("* Uno\n* Dos")).toBe("<ul><li>Uno</li><li>Dos</li></ul>");
  });

  it("convierte una lista numerada", () => {
    expect(markdownToSafeHtml("1. Uno\n2. Dos")).toBe("<ol><li>Uno</li><li>Dos</li></ol>");
  });

  it("envuelve un párrafo simple en <p>", () => {
    expect(markdownToSafeHtml("Hola mundo.")).toBe("<p>Hola mundo.</p>");
  });

  it("une saltos de línea dentro de un párrafo con <br>", () => {
    expect(markdownToSafeHtml("Línea 1\nLínea 2")).toBe("<p>Línea 1<br>Línea 2</p>");
  });

  it("separa bloques por línea en blanco en <p> distintos", () => {
    expect(markdownToSafeHtml("Párrafo uno.\n\nPárrafo dos.")).toBe("<p>Párrafo uno.</p>\n<p>Párrafo dos.</p>");
  });

  it("combina heading + párrafo + lista en un documento", () => {
    const md = "# Notas\n\nUn párrafo.\n\n- Punto 1\n- Punto 2";
    expect(markdownToSafeHtml(md)).toBe(
      "<h1>Notas</h1>\n<p>Un párrafo.</p>\n<ul><li>Punto 1</li><li>Punto 2</li></ul>"
    );
  });

  it("devuelve cadena vacía para input vacío", () => {
    expect(markdownToSafeHtml("")).toBe("");
  });

  it("SEGURIDAD: escapa HTML crudo en vez de inyectarlo (párrafo)", () => {
    const html = markdownToSafeHtml("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("SEGURIDAD: escapa HTML crudo dentro de negrita/listas", () => {
    expect(markdownToSafeHtml("**<script>alert(1)</script>**")).toBe(
      "<p><strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong></p>"
    );
    expect(markdownToSafeHtml("- <svg onload=alert(1)>")).toBe("<ul><li>&lt;svg onload=alert(1)&gt;</li></ul>");
  });

  it("SEGURIDAD: escapa HTML crudo dentro de un heading", () => {
    expect(markdownToSafeHtml("# <script>alert(1)</script>")).toBe("<h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1>");
  });

  it("SEGURIDAD: comillas en el texto no rompen atributos (no hay atributos, pero deben quedar escapadas)", () => {
    const html = markdownToSafeHtml(`Dijo "hola" y 'chau'.`);
    expect(html).toBe("<p>Dijo &quot;hola&quot; y &#39;chau&#39;.</p>");
  });
});
