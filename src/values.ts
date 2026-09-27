/**
 * Typed document values that plain JSON cannot express.
 *
 * Each helper returns a tagged plain object such as
 * `{ $mindoo: "counter", value: 0 }`. Use it anywhere a value is written:
 * `documents.create({ set })`, `documents.update({ set })`, JSON patch `set`
 * and `listInsert` values, also nested inside objects and arrays. Haven turns
 * the tags into the matching collaborative type. Reads return plain JSON:
 * atomic strings as strings, counters as numbers, timestamps as ISO 8601
 * strings.
 *
 * The object key `$mindoo` is reserved; an object carrying it must be one of
 * these values, otherwise the write is rejected.
 */

/** Reserved object key that marks a typed value. */
export const MINDOODB_APP_VALUE_TAG = "$mindoo";

/** A string that is replaced as a whole on concurrent writes. */
export interface MindooDBAppAtomicValue {
  $mindoo: "atomic";
  value: string;
}

/** A number whose concurrent increments are summed on merge. */
export interface MindooDBAppCounterValue {
  $mindoo: "counter";
  value: number;
}

/** A point in time: epoch milliseconds or an ISO 8601 date-time string. */
export interface MindooDBAppTimestampValue {
  $mindoo: "timestamp";
  value: number | string;
}

export type MindooDBAppTypedValue =
  | MindooDBAppAtomicValue
  | MindooDBAppCounterValue
  | MindooDBAppTimestampValue;

export const MindooDBAppValue = {
  /**
   * An atomic string for identifiers, status and enum values, URLs, hashes
   * and stored text cursors. Plain strings are collaborative text, where two
   * concurrent changes of `"open"` to `"closed"` and `"blocked"` can
   * interleave into a mix of both words.
   */
  atomic(value: string): MindooDBAppAtomicValue {
    if (typeof value !== "string") {
      throw new Error("MindooDBAppValue.atomic value must be a string");
    }
    return { $mindoo: "atomic", value };
  },

  /**
   * A collaborative counter with an initial value (a safe integer). Create it
   * once, then change it only with `json.counterIncrement`: writing a new
   * counter is an assignment that does not merge with concurrent increments.
   */
  counter(value = 0): MindooDBAppCounterValue {
    if (!Number.isSafeInteger(value)) {
      throw new Error("MindooDBAppValue.counter value must be a safe integer");
    }
    return { $mindoo: "counter", value };
  },

  /** A timestamp from a `Date`, epoch milliseconds or an ISO 8601 string. */
  timestamp(value: Date | number | string): MindooDBAppTimestampValue {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (
      (typeof value === "string" && value.trim() === "") ||
      Number.isNaN(date.getTime())
    ) {
      throw new Error(
        "MindooDBAppValue.timestamp value must be a Date, epoch milliseconds or an ISO 8601 date-time string",
      );
    }
    return { $mindoo: "timestamp", value: date.toISOString() };
  },

  /** Whether `value` is a tagged typed value (any kind). */
  isTyped(value: unknown): value is MindooDBAppTypedValue {
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.prototype.hasOwnProperty.call(value, MINDOODB_APP_VALUE_TAG)
    );
  },
} as const;
