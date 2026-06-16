import Combine
import CoreData
import SwiftUI

struct ReadingTimerView: View {
    @Environment(\.managedObjectContext) private var ctx
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var book: BookEntity

    @StateObject private var timer = ReadingTimerModel()
    @State private var showSummary = false
    @State private var pagesReadText = ""
    @State private var newCurrentPageText = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 32) {
                Spacer()

                VStack(spacing: 8) {
                    Text(book.title ?? "Reading")
                        .font(.title2.weight(.semibold))
                        .multilineTextAlignment(.center)
                    Text(book.displayAuthors)
                        .font(.subheadline).foregroundColor(.secondary)
                }
                .padding(.horizontal)

                Text(Format.clock(from: timer.elapsedSeconds))
                    .font(.system(size: 72, weight: .light, design: .rounded))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .animation(.easeOut(duration: 0.15), value: timer.elapsedSeconds)

                HStack(spacing: 20) {
                    if timer.isRunning {
                        ActionButton(title: "Pause", systemImage: "pause.fill", tint: .orange) {
                            timer.pause()
                        }
                    } else {
                        ActionButton(title: timer.elapsedSeconds == 0 ? "Start" : "Resume",
                                     systemImage: "play.fill", tint: .green) {
                            timer.start()
                        }
                    }
                    ActionButton(title: "Done", systemImage: "stop.fill", tint: .red) {
                        timer.pause()
                        newCurrentPageText = String(book.currentPage)
                        showSummary = true
                    }
                    .disabled(timer.elapsedSeconds == 0)
                }

                Spacer()
            }
            .padding()
            .navigationTitle("Session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        timer.pause()
                        dismiss()
                    }
                }
            }
            .sheet(isPresented: $showSummary) {
                SummarySheet(
                    elapsed: timer.elapsedSeconds,
                    pagesReadText: $pagesReadText,
                    newCurrentPageText: $newCurrentPageText,
                    onSave: saveSession,
                    onDiscard: {
                        showSummary = false
                        dismiss()
                    }
                )
                .presentationDetents([.medium])
            }
            .onAppear { if timer.elapsedSeconds == 0 { timer.start() } }
            .onDisappear { timer.pause() }
        }
    }

    private func saveSession() {
        let session = ReadingSessionEntity(context: ctx)
        session.id = UUID()
        session.book = book
        let end = Date()
        let start = end.addingTimeInterval(-TimeInterval(timer.elapsedSeconds))
        session.startedAt = start
        session.endedAt = end
        session.durationSeconds = Int32(timer.elapsedSeconds)
        session.pagesRead = Int32(pagesReadText) ?? 0
        session.dayKey = DayKey.make(from: start)

        if let newPage = Int32(newCurrentPageText), newPage >= 0 {
            book.currentPage = newPage
            if book.pageCount > 0, newPage >= book.pageCount {
                book.finishedAt = end
            }
        }
        try? ctx.save()
        WidgetSync.refresh(context: ctx)
        showSummary = false
        dismiss()
    }
}

@MainActor
final class ReadingTimerModel: ObservableObject {
    @Published private(set) var elapsedSeconds: Int = 0
    @Published private(set) var isRunning: Bool = false

    private var cancellable: AnyCancellable?
    private var lastResumeAt: Date?
    private var accumulated: TimeInterval = 0

    func start() {
        guard !isRunning else { return }
        lastResumeAt = Date()
        isRunning = true
        cancellable = Timer.publish(every: 0.25, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in self?.tick() }
    }

    func pause() {
        guard isRunning else { return }
        if let start = lastResumeAt {
            accumulated += Date().timeIntervalSince(start)
        }
        lastResumeAt = nil
        isRunning = false
        cancellable?.cancel()
        cancellable = nil
        elapsedSeconds = Int(accumulated)
    }

    private func tick() {
        let running = lastResumeAt.map { Date().timeIntervalSince($0) } ?? 0
        elapsedSeconds = Int(accumulated + running)
    }
}

private struct ActionButton: View {
    let title: String
    let systemImage: String
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.title2.weight(.semibold))
                Text(title).font(.caption.weight(.semibold))
            }
            .frame(width: 88, height: 76)
            .background(tint.opacity(0.18), in: RoundedRectangle(cornerRadius: 16))
            .foregroundColor(tint)
        }
        .buttonStyle(.plain)
    }
}

private struct SummarySheet: View {
    let elapsed: Int
    @Binding var pagesReadText: String
    @Binding var newCurrentPageText: String
    let onSave: () -> Void
    let onDiscard: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Text("Time read")
                        Spacer()
                        Text(Format.clock(from: elapsed)).monospacedDigit().foregroundColor(.secondary)
                    }
                }
                Section("Progress (optional)") {
                    TextField("Pages read this session", text: $pagesReadText)
                        .keyboardType(.numberPad)
                    TextField("Current page", text: $newCurrentPageText)
                        .keyboardType(.numberPad)
                }
            }
            .navigationTitle("Save session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Discard", role: .destructive, action: onDiscard)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save", action: onSave).fontWeight(.semibold)
                }
            }
        }
    }
}
