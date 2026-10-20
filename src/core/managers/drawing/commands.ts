import { dimensionAnchors, type DrawingAnnotation, type DrawingDocument, type DrawingView, fail, fitsDimension, ok, type Result, sheetSizes } from '@core/contracts';
import type { DrawingCommand } from './drawing-manager';

const invalid = (message: string) => fail({ code: 'invalid-command', message });

/** The views an annotation is attached to. */
export function viewsOf(annotation: DrawingAnnotation): string[] {
  switch (annotation.kind) {
    case 'dimension':
      return annotation.anchors.map((a) => a.view);
    case 'center-mark':
    case 'callout':
      return [annotation.circle.view];
    case 'center-line':
      return [annotation.a.view, annotation.b.view];
    case 'balloon':
    case 'parts-list':
      return [annotation.view];
    case 'note':
      return [];
  }
}

function checkView(document: DrawingDocument, view: DrawingView): string | undefined {
  if (view.scale !== undefined && !(view.scale > 0)) return 'A view scale must be above zero.';
  if (view.detail) {
    const parent = document.views.find((v) => v.id === view.detail?.of);
    if (!parent || parent.id === view.id) return 'A detail shows part of another view of this drawing.';
    if (!(view.detail.radius > 0)) return 'A detail needs a radius above zero.';
  }
  return undefined;
}

function checkAnnotation(document: DrawingDocument, annotation: DrawingAnnotation): string | undefined {
  const views = new Set(document.views.map((v) => v.id));
  if (viewsOf(annotation).some((v) => !views.has(v))) return 'Annotations attach to views of this drawing.';
  if (annotation.kind === 'dimension' && !fitsDimension(annotation.type, annotation.anchors.map((a) => a.kind))) {
    const forms = dimensionAnchors[annotation.type].map((form) => (form.length === 1 ? `a ${form[0]?.join(' or ')}` : `two ${form[0]?.map((k) => `${k}s`).join(' or ')}`));
    return `A ${annotation.type} dimension attaches to ${forms.join(', or ')}.`;
  }
  if (annotation.kind === 'note' && !annotation.text.trim()) return 'A note needs a text.';
  return undefined;
}

/** Pure: applies a command to a drawing. Whether views' sources exist is the manager's job. */
export function applyCommand(document: DrawingDocument, command: DrawingCommand): Result<DrawingDocument> {
  switch (command.type) {
    case 'set-sheet':
      if (!(command.sheet.size in sheetSizes) || !(command.sheet.scale > 0)) return invalid('A sheet needs a size and a scale above zero.');
      return ok({ ...document, sheet: command.sheet });
    case 'set-title-block':
      return ok({ ...document, titleBlock: command.titleBlock });
    case 'add-view':
    case 'edit-view': {
      const exists = document.views.some((v) => v.id === command.view.id);
      if (exists !== (command.type === 'edit-view')) return invalid(exists ? `Id ${command.view.id} is already in use.` : `View ${command.view.id} does not exist.`);
      const problem = checkView(document, command.view);
      if (problem) return invalid(problem);
      const views = exists ? document.views.map((v) => (v.id === command.view.id ? command.view : v)) : [...document.views, command.view];
      return ok({ ...document, views });
    }
    case 'remove-view': {
      if (!document.views.some((v) => v.id === command.viewId)) return invalid(`View ${command.viewId} does not exist.`);
      // Details of the view go with it, and everything attached to either.
      const gone = new Set([command.viewId, ...document.views.filter((v) => v.detail?.of === command.viewId).map((v) => v.id)]);
      return ok({
        ...document,
        views: document.views.filter((v) => !gone.has(v.id)),
        annotations: document.annotations.filter((a) => !viewsOf(a).some((v) => gone.has(v))),
      });
    }
    case 'add-annotation':
    case 'edit-annotation': {
      const exists = document.annotations.some((a) => a.id === command.annotation.id);
      if (exists !== (command.type === 'edit-annotation')) return invalid(exists ? `Id ${command.annotation.id} is already in use.` : `Annotation ${command.annotation.id} does not exist.`);
      const problem = checkAnnotation(document, command.annotation);
      if (problem) return invalid(problem);
      const annotations = exists ? document.annotations.map((a) => (a.id === command.annotation.id ? command.annotation : a)) : [...document.annotations, command.annotation];
      return ok({ ...document, annotations });
    }
    case 'remove-annotation':
      if (!document.annotations.some((a) => a.id === command.annotationId)) return invalid(`Annotation ${command.annotationId} does not exist.`);
      return ok({ ...document, annotations: document.annotations.filter((a) => a.id !== command.annotationId) });
  }
}
