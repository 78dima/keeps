/** datetime-local contains local calendar fields, never UTC. */
export function localDateTimeInput(value: Date | string | null | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const two = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${two(date.getMonth()+1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}
export function dateFromInput(input: string, original?: Date | string | null): Date | null {
    if (!input) return null;
    // Opening and saving text must not round seconds or change an ambiguous DST instant.
    return original && input === localDateTimeInput(original) ? new Date(original) : new Date(input);
}
