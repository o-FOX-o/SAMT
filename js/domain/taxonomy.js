import { ConflictError, ValidationError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { normalizeName, normalizedKey, requireName } from "../shared/validation.js";

export const SCOPES = ["action", "result", "both"];
export const STATUSES = ["active", "archived"];

export function createCategory({ id = null, name, description = "", scope = "both", status = "active", now = new Date() } = {}) {
  if (!SCOPES.includes(scope)) throw new ValidationError("Category scope is invalid.");
  if (!STATUSES.includes(status)) throw new ValidationError("Category status is invalid.");
  const stamp = new Date(now).toISOString();
  return { id: id || createId("category", now), name: requireName(name, "Category name"), description: String(description || ""), scope, status, createdAt: stamp, updatedAt: stamp };
}

export function createTag({ id = null, categoryId, name, description = "", scope = "both", status = "active", now = new Date() } = {}, categories = []) {
  const category = categories.find((item) => item.id === categoryId);
  if (!category) throw new ValidationError("Tag must belong to an existing Category.");
  if (!SCOPES.includes(scope) || !scopeAllowed(category.scope, scope)) throw new ValidationError("Tag scope is broader than its Category scope.");
  if (!STATUSES.includes(status)) throw new ValidationError("Tag status is invalid.");
  const stamp = new Date(now).toISOString();
  return { id: id || createId("tag", now), categoryId, name: requireName(name, "Tag name"), description: String(description || ""), scope, status, createdAt: stamp, updatedAt: stamp };
}

export function scopeAllowed(categoryScope, tagScope) {
  if (categoryScope === "both") return SCOPES.includes(tagScope);
  return tagScope === categoryScope;
}

export function assertUniqueTaxonomyName(items, name, exceptId = null, label = "item") {
  const key = normalizedKey(name);
  if (items.some((item) => item.id !== exceptId && normalizedKey(item.name) === key)) {
    throw new ConflictError(`A ${label} with that name already exists.`);
  }
}

export function validateTaxonomy({ categories = [], tags = [] } = {}) {
  const categoryIds = new Set();
  const categoryNames = new Set();
  for (const category of categories) {
    if (!category?.id || categoryIds.has(category.id)) throw new ValidationError("Category IDs must be stable and unique.");
    if (!normalizeName(category.name)) throw new ValidationError("Category names are required.");
    if (categoryNames.has(normalizedKey(category.name))) throw new ConflictError(`Duplicate Category: ${category.name}`);
    if (!SCOPES.includes(category.scope) || !STATUSES.includes(category.status)) throw new ValidationError("Category configuration is invalid.");
    categoryIds.add(category.id); categoryNames.add(normalizedKey(category.name));
  }
  const tagIds = new Set(); const tagNames = new Set();
  for (const tag of tags) {
    if (!tag?.id || tagIds.has(tag.id)) throw new ValidationError("Tag IDs must be stable and unique.");
    const category = categories.find((item) => item.id === tag.categoryId);
    if (!category) throw new ValidationError(`Tag ${tag.name || tag.id} references a missing Category.`);
    if (!scopeAllowed(category.scope, tag.scope)) throw new ValidationError(`Tag ${tag.name} has an invalid scope.`);
    const local = `${tag.categoryId}:${normalizedKey(tag.name)}`;
    if (tagNames.has(local)) throw new ConflictError(`Duplicate Tag: ${tag.name}`);
    if (!SCOPES.includes(tag.scope) || !STATUSES.includes(tag.status)) throw new ValidationError("Tag configuration is invalid.");
    tagIds.add(tag.id); tagNames.add(local);
  }
  return true;
}
