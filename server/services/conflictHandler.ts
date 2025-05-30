import { storage } from '../storage';
import { sendInteractiveMessage } from './slack';

/**
 * Handle user responses to conflict resolution messages
 */
export async function handleConflictResolution(
  slackUserId: string,
  taskId: number,
  action: string,
  payload: any
) {
  console.log(`[CONFLICT_HANDLER] Processing ${action} for task ${taskId} from user ${slackUserId}`);
  
  try {
    // Get the user and task from database
    const user = await storage.getUserBySlackUserId(slackUserId);
    const task = await storage.getTask(taskId);
    
    if (!user || !task) {
      console.error(`[CONFLICT_HANDLER] User or task not found - user: ${!!user}, task: ${!!task}`);
      return;
    }
    
    switch (action) {
      case 'bump_existing_tasks':
        await handleBumpExistingTasks(user, task, payload);
        break;
      case 'schedule_later':
        await handleScheduleLater(user, task, payload);
        break;
      case 'force_schedule':
        await handleForceSchedule(user, task, payload);
        break;
      case 'find_alternative':
        await handleFindAlternative(user, task, payload);
        break;
      case 'skip':
        await handleSkipTask(user, task, payload);
        break;
      default:
        console.error(`[CONFLICT_HANDLER] Unknown action: ${action}`);
    }
    
  } catch (error) {
    console.error(`[CONFLICT_HANDLER] Error processing conflict resolution:`, error);
  }
}

/**
 * Force schedule the task despite conflicts
 */
async function handleForceSchedule(user: any, task: any, payload: any) {
  console.log(`[CONFLICT_HANDLER] Force scheduling task ${task.id}`);
  
  try {
    // Update task status back to accepted for scheduler to process
    await storage.updateTaskStatus(task.id, 'accepted');
    
    // Import scheduler functions
    const { scheduleTaskInSlot, findAvailableSlots } = await import('./scheduler');
    
    // Find the original time slot that had conflicts
    const now = new Date();
    const endTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Next 24 hours
    
    // Try to schedule in the first available slot, ignoring conflicts
    const durationMs = 3600000; // 1 hour default
    const userOffset = user.timezoneOffset || '+00:00';
    const slots = await findAvailableSlots(now, endTime, [], durationMs, user.id, userOffset);
    
    if (slots.length > 0) {
      const slot = slots[0];
      await scheduleTaskInSlot(user, task, slot, user.timezoneOffset || '+00:00');
      
      // Send success message
      await sendInteractiveMessage(user.slackUserId, {
        text: `✅ Task "${task.title}" scheduled successfully!`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Task scheduled despite conflicts*\n\n**"${task.title}"** has been added to your calendar at ${slot.start.toLocaleString()}.\n\n*Note: This may overlap with existing events.*`
            }
          }
        ]
      });
    } else {
      throw new Error('No available slots found');
    }
    
    console.log(`[CONFLICT_HANDLER] Successfully force scheduled task ${task.id}`);
    
  } catch (error) {
    console.error(`[CONFLICT_HANDLER] Error force scheduling task:`, error);
    
    // Send error message
    await sendInteractiveMessage(user.slackUserId, {
      text: `❌ Failed to schedule task "${task.title}"`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ *Scheduling failed*\n\nSorry, I couldn't schedule "${task.title}" right now. Please try again later or schedule it manually in your calendar.`
          }
        }
      ]
    });
  }
}

/**
 * Handle bumping existing tasks to make room for new task
 */
async function handleBumpExistingTasks(user: any, task: any, payload: any) {
  console.log(`[CONFLICT_HANDLER] Bumping existing tasks for task ${task.id}`);
  
  try {
    // Get conflictingTaskIds from the action data passed from routes.ts
    console.log(`[CONFLICT_HANDLER] Task object:`, task);
    
    // The conflictingTaskIds should be in the payload from the button value
    const actionData = JSON.parse(payload.actions[0].value);
    console.log(`[CONFLICT_HANDLER] Action data from button:`, actionData);
    
    const conflictingTaskIds = actionData.conflictingTaskIds;
    console.log(`[CONFLICT_HANDLER] Conflicting task IDs:`, conflictingTaskIds);
    console.log(`[CONFLICT_HANDLER] Type check - Array.isArray():`, Array.isArray(conflictingTaskIds));
    
    if (!conflictingTaskIds) {
      throw new Error(`No conflictingTaskIds found in action data`);
    }
    
    if (!Array.isArray(conflictingTaskIds)) {
      throw new Error(`conflictingTaskIds is not an array: ${typeof conflictingTaskIds}, value: ${JSON.stringify(conflictingTaskIds)}`);
    }
    const { findAvailableSlots, scheduleTaskInSlot } = await import('./scheduler');
    const { getCalendarEvents } = await import('./calendarService');
    
    // Get the next 7 days to find available slots
    const now = new Date();
    const endTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    // Fetch calendar events to find truly available slots
    const events = await getCalendarEvents(user, now, endTime);
    const busySlots = events.flatMap((ev: any) => {
      const startStr = ev.start?.dateTime ?? ev.start?.date;
      const endStr = ev.end?.dateTime ?? ev.end?.date;
      if (!startStr || !endStr) return [];
      return [{
        start: new Date(startStr),
        end: new Date(endStr),
        eventId: ev.id,
        title: ev.summary || 'Untitled Event'
      }];
    });
    
    const durationMs = 3600000; // 1 hour default
    const userOffset = user.timezoneOffset || '+00:00';
    
    // Move each conflicting task to next available slot
    for (const taskId of conflictingTaskIds) {
      const conflictingTask = await storage.getTask(taskId);
      if (!conflictingTask) continue;
      
      const availableSlots = await findAvailableSlots(now, endTime, busySlots, durationMs, user.id, userOffset);
      
      if (availableSlots.length > 0) {
        const newSlot = availableSlots[0];
        await scheduleTaskInSlot(user, conflictingTask, newSlot, userOffset);
        console.log(`[CONFLICT_HANDLER] Moved task ${taskId} to ${newSlot.start}`);
        
        // Update busy slots to prevent double-booking
        busySlots.push({
          start: newSlot.start,
          end: newSlot.end,
          eventId: `moved-${taskId}`,
          title: conflictingTask.title
        });
      }
    }
    
    // Now schedule the incoming task in the first available slot
    const finalAvailableSlots = await findAvailableSlots(now, endTime, busySlots, durationMs, user.id, userOffset);
    if (finalAvailableSlots.length > 0) {
      await scheduleTaskInSlot(user, task, finalAvailableSlots[0], userOffset);
      
      // Send success message
      await sendInteractiveMessage(user.slackUserId, {
        text: `✅ Tasks rescheduled successfully!`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ **Tasks rescheduled successfully!**\n\nI've moved your conflicting tasks to later times and scheduled **"${task.title}"** in the freed slot.\n\nCheck your calendar for the updated schedule.`
            }
          }
        ]
      });
    }
    
  } catch (error) {
    console.error(`[CONFLICT_HANDLER] Error bumping existing tasks:`, error);
    
    await sendInteractiveMessage(user.slackUserId, {
      text: `❌ Error rescheduling tasks`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ **Error rescheduling tasks**\n\nSorry, I encountered an error while trying to reschedule your tasks. Please try again or schedule manually.`
          }
        }
      ]
    });
  }
}

/**
 * Handle scheduling the new task for later
 */
async function handleScheduleLater(user: any, task: any, payload: any) {
  console.log(`[CONFLICT_HANDLER] Scheduling task ${task.id} for later`);
  
  try {
    const { findAvailableSlots, scheduleTaskInSlot } = await import('./scheduler');
    const { getCalendarEvents } = await import('./calendarService');
    
    // Get the next 7 days to find available slots
    const now = new Date();
    const endTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    // Fetch calendar events
    const events = await getCalendarEvents(user, now, endTime);
    const busySlots = events.flatMap((ev: any) => {
      const startStr = ev.start?.dateTime ?? ev.start?.date;
      const endStr = ev.end?.dateTime ?? ev.end?.date;
      if (!startStr || !endStr) return [];
      return [{
        start: new Date(startStr),
        end: new Date(endStr),
        eventId: ev.id,
        title: ev.summary || 'Untitled Event'
      }];
    });
    
    const durationMs = 3600000; // 1 hour default
    const userOffset = user.timezoneOffset || '+00:00';
    
    // Find next available slot for this task
    const availableSlots = await findAvailableSlots(now, endTime, busySlots, durationMs, user.id, userOffset);
    
    if (availableSlots.length > 0) {
      await scheduleTaskInSlot(user, task, availableSlots[0], userOffset);
      
      // Send success message
      await sendInteractiveMessage(user.slackUserId, {
        text: `✅ Task scheduled for later!`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ **Task scheduled for later!**\n\n**"${task.title}"** has been scheduled for ${availableSlots[0].start.toLocaleString()} to avoid conflicts with your existing tasks.`
            }
          }
        ]
      });
    } else {
      // No available slots found
      await sendInteractiveMessage(user.slackUserId, {
        text: `📅 No available time slots found`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📅 **No available time slots found**\n\nI couldn't find any free time in the next 7 days for **"${task.title}"**. Please provide a specific time slot or manually schedule this task.`
            }
          }
        ]
      });
      
      // Reset task status for manual handling
      await storage.updateTaskStatus(task.id, 'accepted');
    }
    
  } catch (error) {
    console.error(`[CONFLICT_HANDLER] Error scheduling task later:`, error);
    
    await sendInteractiveMessage(user.slackUserId, {
      text: `❌ Error scheduling task`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ **Error scheduling task**\n\nSorry, I encountered an error while trying to schedule **"${task.title}"**. Please try again or schedule manually.`
          }
        }
      ]
    });
  }
}

/**
 * Find and suggest alternative time slots
 */
async function handleFindAlternative(user: any, task: any, payload: any) {
  console.log(`[CONFLICT_HANDLER] Finding alternative times for task ${task.id}`);
  
  try {
    // Import calendar and scheduler functions
    const { getCalendarEvents } = await import('./calendarService');
    const { findAvailableSlots, parseBusySlots } = await import('./scheduler');
    
    // Get calendar events for the next few days
    const now = new Date();
    const endTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // Next 7 days
    
    // Fetch calendar events
    const events = await getCalendarEvents(user, now, endTime);
    const busySlots = parseBusySlots(events);
    
    // Find available slots (using proper parameters)
    const durationMs = 3600000; // 1 hour default
    const userOffset = user.timezoneOffset || '+00:00';
    const availableSlots = await findAvailableSlots(now, endTime, busySlots, durationMs, user.id, userOffset);
    
    if (availableSlots.length === 0) {
      // No alternatives found
      await sendInteractiveMessage(user.slackUserId, {
        text: `📅 No alternative times found for "${task.title}"`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📅 *No alternative times available*\n\nI couldn't find any free slots for "${task.title}" in the next 7 days that don't conflict with your calendar.\n\nYou can try:\n• Scheduling it manually\n• Force scheduling despite conflicts\n• Skipping this task for now`
            }
          }
        ]
      });
      
      // Reset task status for later processing
      await storage.updateTaskStatus(task.id, 'accepted');
      return;
    }
    
    // Limit to top 3 suggestions
    const topSlots = availableSlots.slice(0, 3);
    
    // Create interactive buttons for each time slot
    const elements = topSlots.map((slot, index) => ({
      type: 'button',
      text: {
        type: 'plain_text',
        text: `${slot.start.toLocaleDateString()} at ${slot.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      },
      action_id: `schedule_at_time_${index}`,
      value: JSON.stringify({
        taskId: task.id,
        action: 'schedule_at_specific_time',
        slot: {
          start: slot.start.toISOString(),
          end: slot.end.toISOString()
        }
      })
    }));
    
    // Send alternative time options
    await sendInteractiveMessage(user.slackUserId, {
      text: `📅 Alternative times for "${task.title}"`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📅 *Alternative times for "${task.title}"*\n\nHere are the next available time slots that don't conflict with your calendar:`
          }
        },
        {
          type: 'actions',
          elements: elements
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Or choose one of these options:`
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Schedule Anyway (Override)' },
              style: 'primary',
              action_id: 'schedule_anyway',
              value: JSON.stringify({
                taskId: task.id,
                action: 'force_schedule'
              })
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Skip for Now' },
              style: 'danger',
              action_id: 'skip_task',
              value: JSON.stringify({
                taskId: task.id,
                action: 'skip'
              })
            }
          ]
        }
      ]
    });
    
    console.log(`[CONFLICT_HANDLER] Sent ${topSlots.length} alternative time suggestions for task ${task.id}`);
    
  } catch (error) {
    console.error(`[CONFLICT_HANDLER] Error finding alternatives:`, error);
    
    // Send error message and reset task status
    await sendInteractiveMessage(user.slackUserId, {
      text: `❌ Error finding alternative times`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ *Error finding alternatives*\n\nSorry, I encountered an error while looking for alternative times for "${task.title}". Please try again later.`
          }
        }
      ]
    });
    
    // Reset task status for later processing
    await storage.updateTaskStatus(task.id, 'accepted');
  }
}

/**
 * Skip the task for now
 */
async function handleSkipTask(user: any, task: any, payload: any) {
  console.log(`[CONFLICT_HANDLER] Skipping task ${task.id}`);
  
  try {
    // Update task status to skipped
    await storage.updateTaskStatus(task.id, 'skipped');
    
    // Send confirmation message
    await sendInteractiveMessage(user.slackUserId, {
      text: `⏭️ Task "${task.title}" skipped`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⏭️ *Task skipped*\n\n"${task.title}" has been skipped for now. You can reschedule it manually later from the TaskFlow dashboard.`
          }
        }
      ]
    });
    
    console.log(`[CONFLICT_HANDLER] Successfully skipped task ${task.id}`);
    
  } catch (error) {
    console.error(`[CONFLICT_HANDLER] Error skipping task:`, error);
  }
}