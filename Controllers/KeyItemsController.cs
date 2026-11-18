using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/key-items")]
[Authorize]
public sealed class KeyItemsController : ControllerBase
{
    private readonly KeyItemRepository _repository;
    public KeyItemsController(KeyItemRepository repository) => _repository = repository;
    [HttpGet("reference-data")] public async Task<IActionResult> Reference(CancellationToken ct)=>Ok(await _repository.GetReferenceAsync(ct));
    [HttpGet] public async Task<IActionResult> List([FromQuery]int? projectId,[FromQuery]string? status,[FromQuery]string? keyword,CancellationToken ct)=>Ok(await _repository.ListAsync(projectId,status,keyword,ct));
    [HttpGet("{id:int}")] public async Task<IActionResult> Get(int id,CancellationToken ct){var item=await _repository.GetAsync(id,ct);return item is null?NotFound(new{message="关键事项不存在。"}):Ok(item);}
    [HttpPost] public async Task<IActionResult> Create([FromBody]KeyItemRequest request,CancellationToken ct){try{return Ok(new{id=await _repository.CreateAsync(request,User.GetDisplayName(),ct),message="关键事项已新增。"});}catch(ArgumentException ex){return BadRequest(new{message=ex.Message});}}
    [HttpPut("{id:int}")] public async Task<IActionResult> Update(int id,[FromBody]KeyItemRequest request,CancellationToken ct){try{await _repository.UpdateAsync(id,request,User.GetDisplayName(),ct);return Ok(new{message="关键事项已更新。"});}catch(ArgumentException ex){return BadRequest(new{message=ex.Message});}catch(InvalidOperationException ex){return Conflict(new{message=ex.Message});}}
    [HttpDelete("{id:int}")] public async Task<IActionResult> Delete(int id,CancellationToken ct){try{await _repository.DeleteAsync(id,User.GetDisplayName(),ct);return Ok(new{message="关键事项已删除。"});}catch(KeyNotFoundException ex){return NotFound(new{message=ex.Message});}}
    [HttpGet("{id:int}/tasks")] public async Task<IActionResult> Tasks(int id,CancellationToken ct)=>Ok(await _repository.GetTasksAsync(id,ct));
    [HttpPost("{id:int}/tasks")] public async Task<IActionResult> CreateTask(int id,[FromBody]KeyItemTaskRequest request,CancellationToken ct){try{return Ok(new{id=await _repository.CreateTaskAsync(id,request,User.GetDisplayName(),ct),message="细分任务已新增。"});}catch(ArgumentException ex){return BadRequest(new{message=ex.Message});}catch(KeyNotFoundException ex){return NotFound(new{message=ex.Message});}}
    [HttpPut("tasks/{taskId:int}")] public async Task<IActionResult> UpdateTask(int taskId,[FromBody]KeyItemTaskRequest request,CancellationToken ct){try{await _repository.UpdateTaskAsync(taskId,request,User.GetDisplayName(),ct);return Ok(new{message="细分任务已更新。"});}catch(ArgumentException ex){return BadRequest(new{message=ex.Message});}catch(InvalidOperationException ex){return Conflict(new{message=ex.Message});}}
    [HttpPatch("tasks/{taskId:int}/completion")] public async Task<IActionResult> UpdateTaskCompletion(int taskId,[FromBody]KeyItemTaskCompletionRequest request,CancellationToken ct){try{await _repository.UpdateTaskCompletionAsync(taskId,request,User.GetDisplayName(),ct);return Ok(new{message=request.IsCompleted?"细分任务已标记完成。":"细分任务已取消完成。"});}catch(InvalidOperationException ex){return Conflict(new{message=ex.Message});}}
    [HttpDelete("tasks/{taskId:int}")] public async Task<IActionResult> DeleteTask(int taskId,CancellationToken ct){try{await _repository.DeleteTaskAsync(taskId,User.GetDisplayName(),ct);return Ok(new{message="细分任务已删除。"});}catch(KeyNotFoundException ex){return NotFound(new{message=ex.Message});}}
}
