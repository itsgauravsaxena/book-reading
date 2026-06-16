import SwiftUI

struct BookCover: View {
    let url: URL?
    let title: String
    var width: CGFloat = 64

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let img):
                        img.resizable().scaledToFill()
                    case .empty:
                        placeholder.overlay(ProgressView())
                    case .failure:
                        placeholder
                    @unknown default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: width, height: width * 1.5)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(Color.black.opacity(0.08))
        )
        .shadow(color: .black.opacity(0.12), radius: 3, x: 0, y: 1)
    }

    private var placeholder: some View {
        LinearGradient(colors: [.accentColor.opacity(0.35), .accentColor.opacity(0.85)],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
            .overlay(
                Text(initials)
                    .font(.system(size: width * 0.4, weight: .bold, design: .serif))
                    .foregroundColor(.white.opacity(0.9))
            )
    }

    private var initials: String {
        let words = title.split(separator: " ")
        let chars = words.prefix(2).compactMap { $0.first }.map(String.init)
        return chars.joined().uppercased()
    }
}
