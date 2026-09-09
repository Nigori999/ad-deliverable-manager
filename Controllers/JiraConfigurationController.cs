using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/master-data/jira-connection")]
[Authorize]
public sealed class JiraConfigurationController : ControllerBase
{
    private readonly JiraConfigurationRepository _configuration;
    private readonly JiraBoardService _service;

    public JiraConfigurationController(JiraConfigurationRepository configuration, JiraBoardService service)
    {
        _configuration = configuration;
        _service = service;
    }

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct) => Ok(await _configuration.GetGlobalConfigurationViewAsync(ct));

    [HttpPut]
    public async Task<IActionResult> Save([FromBody] JiraGlobalConfigurationRequest request, CancellationToken ct)
    {
        try
        {
            await _configuration.SaveGlobalConfigurationAsync(request, User.GetDisplayName(), ct);
            return Ok(new { message = "Jira全局连接配置已保存。" });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
    }

    [HttpPut("test")]
    public async Task<IActionResult> Test([FromBody] JiraGlobalConfigurationRequest request, CancellationToken ct)
    {
        try { return Ok(await _service.TestConnectionAsync(request, ct)); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (JiraBoardException ex) { return StatusCode(StatusCodes.Status502BadGateway, new { message = ex.Message }); }
    }
}
