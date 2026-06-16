import Foundation

/// Minimal RFC-4180 CSV parser: handles quoted fields, commas and newlines
/// inside quotes, and doubled "" escaping. Returns rows of string fields.
enum CSVParser {
    static func parse(_ text: String) -> [[String]] {
        var rows: [[String]] = []
        var field = ""
        var row: [String] = []
        var inQuotes = false
        let scalars = Array(text)
        var i = 0

        func endField() {
            row.append(field)
            field = ""
        }
        func endRow() {
            endField()
            // Skip blank lines (a single empty field)
            if !(row.count == 1 && row[0].isEmpty) {
                rows.append(row)
            }
            row = []
        }

        while i < scalars.count {
            let c = scalars[i]
            if inQuotes {
                if c == "\"" {
                    if i + 1 < scalars.count && scalars[i + 1] == "\"" {
                        field.append("\"")
                        i += 1
                    } else {
                        inQuotes = false
                    }
                } else {
                    field.append(c)
                }
            } else {
                switch c {
                case "\"":
                    inQuotes = true
                case ",":
                    endField()
                case "\r":
                    break // handled by following \n, or ignored
                case "\n":
                    endRow()
                default:
                    field.append(c)
                }
            }
            i += 1
        }
        // Flush trailing field/row (file not ending in newline)
        if !field.isEmpty || !row.isEmpty {
            endRow()
        }
        return rows
    }
}
