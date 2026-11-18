using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/project-plans")]
[Authorize]
public sealed class ProjectPlansController : ControllerBase
{
    private readonly ProjectPlanRepository _repository;
    public ProjectPlansController(ProjectPlanRepository repository) => _repository = repository;

    [HttpGet] public async Task<IActionResult> Get([FromQuery] int? projectId,CancellationToken ct)=>Ok(await _repository.GetAsync(projectId,ct));
    [HttpPut] public async Task<IActionResult> SavePlan([FromBody] VehicleProjectPlanRequest request,CancellationToken ct){try{return Ok(new{id=await _repository.SavePlanAsync(request,User.GetDisplayName(),ct),message="整车项目计划周期已保存。"});}catch(ArgumentException ex){return BadRequest(new{message=ex.Message});}}
    [HttpPost("{planId:int}/nodes")] public async Task<IActionResult> CreateNode(int planId,[FromBody] ProjectPlanNodeRequest request,CancellationToken ct){try{return Ok(new{id=await _repository.CreateNodeAsync(planId,request,User.GetDisplayName(),ct),message="计划节点已新增。"});}catch(ArgumentException ex){return BadRequest(new{message=ex.Message});}}
    [HttpPut("nodes/{nodeId:int}")] public async Task<IActionResult> UpdateNode(int nodeId,[FromBody] ProjectPlanNodeRequest request,CancellationToken ct){try{await _repository.UpdateNodeAsync(nodeId,request,User.GetDisplayName(),ct);return Ok(new{message="计划节点已更新。"});}catch(ArgumentException ex){return BadRequest(new{message=ex.Message});}catch(InvalidOperationException ex){return Conflict(new{message=ex.Message});}catch(KeyNotFoundException ex){return NotFound(new{message=ex.Message});}}
    [HttpPost("nodes/{nodeId:int}/deactivate")] public async Task<IActionResult> DeactivateNode(int nodeId,CancellationToken ct){try{await _repository.DeactivateNodeAsync(nodeId,User.GetDisplayName(),ct);return Ok(new{message="计划节点已停用。"});}catch(InvalidOperationException ex){return Conflict(new{message=ex.Message});}catch(KeyNotFoundException ex){return NotFound(new{message=ex.Message});}}
    [HttpGet("nodes/{nodeId:int}/items")] public async Task<IActionResult> GetItems(int nodeId,CancellationToken ct)=>Ok(await _repository.GetItemsAsync(nodeId,ct));
    [HttpPost("nodes/{nodeId:int}/items")] public async Task<IActionResult> CreateItem(int nodeId,[FromBody] ProjectPlanItemRequest request,CancellationToken ct){try{return Ok(new{id=await _repository.CreateItemAsync(nodeId,request,User.GetDisplayName(),ct),message="计划事项已新增。"});}catch(ArgumentException ex){return BadRequest(new{message=ex.Message});}catch(KeyNotFoundException ex){return NotFound(new{message=ex.Message});}}
    [HttpPut("items/{itemId:int}")] public async Task<IActionResult> UpdateItem(int itemId,[FromBody] ProjectPlanItemRequest request,CancellationToken ct){try{await _repository.UpdateItemAsync(itemId,request,User.GetDisplayName(),ct);return Ok(new{message="计划事项已更新。"});}catch(ArgumentException ex){return BadRequest(new{message=ex.Message});}catch(InvalidOperationException ex){return Conflict(new{message=ex.Message});}catch(KeyNotFoundException ex){return NotFound(new{message=ex.Message});}}
    [HttpDelete("items/{itemId:int}")] public async Task<IActionResult> DeleteItem(int itemId,CancellationToken ct){try{await _repository.DeleteItemAsync(itemId,User.GetDisplayName(),ct);return Ok(new{message="计划事项已删除。"});}catch(KeyNotFoundException ex){return NotFound(new{message=ex.Message});}}
}
