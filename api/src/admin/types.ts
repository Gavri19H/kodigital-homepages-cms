/**
 * Shared admin module types and helpers.
 * Ported from the legacy admin (adapted for multi-site: list queries may
 * carry a site_id filter).
 */

/**
 * Query parameters for paginated list endpoints
 */
export interface ListQueryParams {
  page?: string;
  per_page?: string;
  status?: string;
  category_id?: string;
  site_id?: string;
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
}

/**
 * Pagination result metadata
 */
export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_prev: boolean;
  has_next: boolean;
}

/**
 * API response wrapper for list endpoints
 */
export interface ListResponse<T> {
  items: T[];
  pagination: PaginationMeta;
}

/**
 * API response wrapper for single item endpoints
 */
export interface ItemResponse<T> {
  item: T;
}

/**
 * Error response
 */
export interface ErrorResponse {
  error: string;
  details?: string;
}

/**
 * Calculate pagination metadata
 */
export function calculatePagination(
  page: number,
  perPage: number,
  total: number
): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  return {
    page,
    per_page: perPage,
    total,
    total_pages: totalPages,
    has_prev: page > 1,
    has_next: page < totalPages,
  };
}

/**
 * Parse pagination params from query string
 */
export function parsePaginationParams(query: ListQueryParams): {
  page: number;
  perPage: number;
  offset: number;
} {
  const page = Math.max(1, parseInt(query.page || "1", 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(query.per_page || "20", 10) || 20));
  const offset = (page - 1) * perPage;
  return { page, perPage, offset };
}

/**
 * Validate that an ID is a positive integer
 */
export function isValidId(id: string): boolean {
  const num = parseInt(id, 10);
  return !isNaN(num) && num > 0 && String(num) === id;
}

/**
 * Generate a URL-safe slug from a string
 */
export function generateSlug(text: string, maxLength = 100): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove non-word chars except spaces and hyphens
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single
    .replace(/^-|-$/g, "") // Remove leading/trailing hyphens
    .slice(0, maxLength);
}

/**
 * Escape HTML for safe rendering
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (char) => map[char] ?? char);
}
