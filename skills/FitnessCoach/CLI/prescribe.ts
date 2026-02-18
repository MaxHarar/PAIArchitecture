#!/usr/bin/env bun
/**
 * Prescription CLI
 *
 * Command-line interface for workout prescription engine.
 * Generate prescriptions, view upcoming workouts, provide feedback.
 */

import { getDatabase } from "../../../fitness/src/db/client.ts";
import { prescribeWorkout } from "../Tools/prescription-engine.ts";
import { formatPrescriptionForTelegram } from "../Notifications/prescription-formatter.ts";

// =============================================================================
// TYPES
// =============================================================================

interface PrescribeOptions {
  date?: string;
  goalId?: number;
  notify?: boolean;
  preview?: boolean;
}

interface FeedbackOptions {
  workoutId: number;
  rating: "too_hard" | "too_easy" | "perfect";
  notes?: string;
}

// =============================================================================
// COMMANDS
// =============================================================================

/**
 * Generate workout prescription
 */
async function commandPrescribe(options: PrescribeOptions = {}) {
  const db = getDatabase();

  try {
    // Get date (default to today)
    const date = options.date ?? new Date().toISOString().split("T")[0]!;

    console.log(`\n🏃 Generating prescription for ${date}...\n`);

    // Generate prescription
    const prescription = await prescribeWorkout(db, date, options.goalId ?? null);

    // Format for Telegram
    const message = formatPrescriptionForTelegram(prescription);

    // Display
    console.log("━".repeat(60));
    console.log(message.text.replace(/<b>/g, "").replace(/<\/b>/g, "").replace(/<i>/g, "").replace(/<\/i>/g, ""));
    console.log("━".repeat(60));

    // Calculate day_of_week (0=Sunday, 6=Saturday)
    const prescriptionDate = new Date(prescription.scheduledDate);
    const dayOfWeek = prescriptionDate.getDay();

    // Save to database
    const result = db.queryOne<{ id: number }>(
      `INSERT INTO workout_prescriptions (
        template_id, scheduled_date, scheduled_time, day_of_week, slot,
        name, description, target_duration_seconds, target_distance_meters,
        target_load, intensity_zone, target_hr_min, target_hr_max,
        adaptation_reason, readiness_at_prescription, load_context,
        status
      ) VALUES (?, ?, ?, ?, 'primary', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prescribed')
      RETURNING id`,
      [
        prescription.template.id,
        prescription.scheduledDate,
        prescription.scheduledTime,
        dayOfWeek,
        prescription.template.name,
        prescription.template.description,
        prescription.targetDuration,
        prescription.targetDistance,
        prescription.targetLoad,
        prescription.intensityZone,
        prescription.targetHRMin,
        prescription.targetHRMax,
        JSON.stringify(prescription.adaptationReason),
        prescription.readinessScore,
        JSON.stringify(prescription.loadContext),
      ]
    );

    console.log(`\n✅ Prescription saved (ID: ${result?.id})`);

    // Send notification if requested
    if (options.notify) {
      console.log("\n📱 Sending Telegram notification...");
      // TODO: Integrate with Telegram bot
      console.log("⚠️  Telegram integration pending");
    }

    return prescription;
  } catch (error) {
    console.error("❌ Error generating prescription:", error);
    throw error;
  } finally {
    db.close();
  }
}

/**
 * View upcoming prescriptions
 */
async function commandUpcoming(days: number = 7) {
  const db = getDatabase();

  try {
    const today = new Date().toISOString().split("T")[0]!;
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);
    const endDateStr = endDate.toISOString().split("T")[0]!;

    const prescriptions = db.query<{
      id: number;
      scheduled_date: string;
      name: string;
      target_duration_seconds: number;
      intensity_zone: string;
      status: string;
    }>(
      `SELECT id, scheduled_date, name, target_duration_seconds, intensity_zone, status
       FROM workout_prescriptions
       WHERE scheduled_date >= ? AND scheduled_date <= ?
       ORDER BY scheduled_date`,
      [today, endDateStr]
    );

    console.log(`\n📅 UPCOMING WORKOUTS (next ${days} days)\n`);
    console.log("━".repeat(60));

    if (prescriptions.length === 0) {
      console.log("\nNo upcoming prescriptions. Run 'prescribe' to generate.\n");
    } else {
      for (const p of prescriptions) {
        const date = new Date(p.scheduled_date);
        const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
        const duration = Math.round(p.target_duration_seconds / 60);
        const statusEmoji = p.status === "completed" ? "✅" : p.status === "skipped" ? "⏭️" : "⬜";

        console.log(`${statusEmoji} ${dayName}, ${p.scheduled_date}`);
        console.log(`   ${p.name} - ${duration} min (${p.intensity_zone})`);
        console.log("");
      }
    }

    console.log("━".repeat(60) + "\n");
  } catch (error) {
    console.error("❌ Error fetching upcoming workouts:", error);
    throw error;
  } finally {
    db.close();
  }
}

/**
 * Provide feedback on workout
 */
async function commandFeedback(options: FeedbackOptions) {
  const db = getDatabase();

  try {
    // Get the prescription
    const prescription = db.queryOne<{
      id: number;
      name: string;
      template_id: number;
    }>(
      `SELECT wp.id, wp.name, wp.template_id
       FROM workout_prescriptions wp
       WHERE wp.actual_workout_id = ?`,
      [options.workoutId]
    );

    if (!prescription) {
      console.error(`❌ No prescription found for workout ID ${options.workoutId}`);
      return;
    }

    // Update prescription with feedback
    const tooHard = options.rating === "too_hard" ? 1 : 0;
    const tooEasy = options.rating === "too_easy" ? 1 : 0;
    const rating = options.rating === "perfect" ? 5 : options.rating === "too_easy" ? 4 : 2;

    db.execute(
      `UPDATE workout_prescriptions
       SET was_too_hard = ?, was_too_easy = ?, user_rating = ?, user_notes = ?
       WHERE id = ?`,
      [tooHard, tooEasy, rating, options.notes ?? null, prescription.id]
    );

    // Update template preferences
    db.execute(
      `INSERT INTO workout_type_preferences (template_id, activity_type_id, times_completed, too_hard_count, too_easy_count, avg_rating)
       VALUES (?, NULL, 1, ?, ?, ?)
       ON CONFLICT (template_id, activity_type_id) DO UPDATE SET
         times_completed = times_completed + 1,
         too_hard_count = too_hard_count + ?,
         too_easy_count = too_easy_count + ?,
         avg_rating = ((avg_rating * times_completed) + ?) / (times_completed + 1)`,
      [prescription.template_id, tooHard, tooEasy, rating, tooHard, tooEasy, rating]
    );

    console.log(`\n✅ Feedback recorded for "${prescription.name}"`);
    console.log(`   Rating: ${options.rating.replace("_", " ")}`);
    if (options.notes) {
      console.log(`   Notes: ${options.notes}`);
    }
    console.log("\n📊 Future prescriptions will adapt based on this feedback.\n");
  } catch (error) {
    console.error("❌ Error recording feedback:", error);
    throw error;
  } finally {
    db.close();
  }
}

/**
 * Mark workout as completed
 */
async function commandComplete(workoutId: number) {
  const db = getDatabase();

  try {
    // Get the workout
    const workout = db.queryOne<{
      id: number;
      name: string;
      duration_seconds: number;
      started_at: string;
    }>(
      `SELECT id, name, duration_seconds, started_at FROM workouts WHERE id = ?`,
      [workoutId]
    );

    if (!workout) {
      console.error(`❌ Workout ID ${workoutId} not found`);
      return;
    }

    // Find matching prescription
    const date = new Date(workout.started_at).toISOString().split("T")[0]!;
    const prescription = db.queryOne<{ id: number; target_duration_seconds: number }>(
      `SELECT id, target_duration_seconds
       FROM workout_prescriptions
       WHERE scheduled_date = ? AND actual_workout_id IS NULL
       ORDER BY ABS(target_duration_seconds - ?) ASC
       LIMIT 1`,
      [date, workout.duration_seconds]
    );

    if (prescription) {
      // Link workout to prescription
      const compliance =
        100 - Math.abs(workout.duration_seconds - prescription.target_duration_seconds) / prescription.target_duration_seconds * 100;

      db.execute(
        `UPDATE workout_prescriptions
         SET actual_workout_id = ?, status = 'completed', compliance_score = ?
         WHERE id = ?`,
        [workoutId, Math.max(0, Math.min(100, compliance)), prescription.id]
      );

      console.log(`\n✅ Workout "${workout.name}" marked as completed`);
      console.log(`   Compliance: ${compliance.toFixed(0)}%`);
      console.log("\n💡 Run 'feedback ${workoutId} <too_hard|perfect|too_easy>' to rate difficulty.\n");
    } else {
      console.log(`\n⚠️  No matching prescription found for this workout.`);
      console.log(`   Workout completed but not linked to a prescription.\n`);
    }
  } catch (error) {
    console.error("❌ Error marking workout complete:", error);
    throw error;
  } finally {
    db.close();
  }
}

// =============================================================================
// CLI INTERFACE
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case "prescribe":
      case "generate": {
        const options: PrescribeOptions = {};

        // Parse flags
        for (let i = 1; i < args.length; i++) {
          const arg = args[i];
          if (arg === "--date" && args[i + 1]) {
            options.date = args[i + 1];
            i++;
          } else if (arg === "--goal" && args[i + 1]) {
            options.goalId = parseInt(args[i + 1]!);
            i++;
          } else if (arg === "--notify") {
            options.notify = true;
          }
        }

        await commandPrescribe(options);
        break;
      }

      case "upcoming":
      case "list": {
        const days = args[1] ? parseInt(args[1]) : 7;
        await commandUpcoming(days);
        break;
      }

      case "feedback":
      case "rate": {
        const workoutId = parseInt(args[1] ?? "0");
        const rating = args[2] as "too_hard" | "too_easy" | "perfect";
        const notes = args.slice(3).join(" ");

        if (!workoutId || !rating) {
          console.error("Usage: feedback <workout_id> <too_hard|perfect|too_easy> [notes]");
          process.exit(1);
        }

        await commandFeedback({ workoutId, rating, notes });
        break;
      }

      case "complete":
      case "done": {
        const workoutId = parseInt(args[1] ?? "0");
        if (!workoutId) {
          console.error("Usage: complete <workout_id>");
          process.exit(1);
        }
        await commandComplete(workoutId);
        break;
      }

      default:
        console.log(`Fitness Coach - Prescription CLI

Usage:
  prescribe.ts prescribe [--date YYYY-MM-DD] [--goal ID] [--notify]
    Generate workout prescription for date (default: today)

  prescribe.ts upcoming [days]
    Show upcoming prescriptions (default: 7 days)

  prescribe.ts feedback <workout_id> <too_hard|perfect|too_easy> [notes]
    Provide feedback on workout difficulty

  prescribe.ts complete <workout_id>
    Mark workout as completed and link to prescription

Examples:
  prescribe.ts prescribe
  prescribe.ts prescribe --date 2026-01-28 --notify
  prescribe.ts upcoming 14
  prescribe.ts feedback 123 too_hard "Legs felt heavy"
  prescribe.ts complete 123
`);
    }
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.main) {
  main();
}
